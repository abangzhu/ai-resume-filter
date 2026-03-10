/**
 * CVFilterX - Background Service Worker
 * 职责：LLM API 调用（绕过 CORS）、消息路由、storage 读写、模板管理
 */

// ── 默认配置 ────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  autoPaginateDelay: 2000,
  skipScored: true,
  cacheExpireDays: 7,
  fieldConfig: {
    basicInfo: true,
    education: true,
    workExperience: true,
    projectExperience: true,
    skills: true,
    selfIntroduction: true,
  },
  // dimensionConfig 和 promptTemplate 已迁移至模板系统
};

const DEFAULT_DIMENSIONS = [
  {
    key: "educationMatch",
    label: "学历匹配",
    description: "候选人学历、专业与岗位要求的匹配程度",
    weight: 20,
  },
  {
    key: "experienceMatch",
    label: "经验匹配",
    description: "工作年限、行业背景与岗位要求的匹配程度",
    weight: 30,
  },
  {
    key: "skillMatch",
    label: "技能匹配",
    description: "技术技能、工具与岗位要求的匹配程度",
    weight: 30,
  },
  {
    key: "stability",
    label: "工作稳定性",
    description: "历史工作年限分布，评估跳槽频率",
    weight: 10,
  },
  {
    key: "growthPotential",
    label: "成长潜力",
    description: "职业发展轨迹、晋升节奏与成长空间",
    weight: 10,
  },
];

const SYSTEM_PROMPT_DEFAULT = `你是一名专业的招聘评估助手。根据提供的岗位描述（JD）和候选人简历，按照指定维度对候选人进行客观评估。
输出必须是合法的 JSON，不要包含任何 markdown 代码块或额外说明文字。`;

// ── 模板系统：UUID 生成 ─────────────────────────────────────
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── 模板系统：迁移逻辑 ──────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  await migrateToTemplateSystem();
});

async function migrateToTemplateSystem() {
  const data = await chrome.storage.local.get(["templates", "settings"]);

  // 已有模板数据则跳过迁移
  if (data.templates && Object.keys(data.templates).length > 0) return;

  const settings = data.settings ?? {};
  const dimConfig = settings.dimensionConfig ?? DEFAULT_DIMENSIONS;
  const promptTemplate = settings.promptTemplate ?? "";

  const defaultTemplateId = generateUUID();
  const now = Date.now();

  const templates = {
    [defaultTemplateId]: {
      id: defaultTemplateId,
      name: "默认模板",
      description: "通用候选人评估模板",
      dimensionConfig: dimConfig,
      promptTemplate,
      matchKeywords: [],
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
  };

  await chrome.storage.local.set({ templates });

  // 从 settings 中移除已迁移的字段
  const { dimensionConfig: _d, promptTemplate: _p, ...cleanSettings } = settings;
  await chrome.storage.local.set({ settings: cleanSettings });

  console.log("[CVFilterX] 模板系统迁移完成，默认模板 ID:", defaultTemplateId);
}

// ── 模板系统：CRUD ──────────────────────────────────────────
async function getTemplates() {
  const data = await chrome.storage.local.get("templates");
  const templates = data.templates ?? {};

  // 如果没有任何模板，创建一个默认的
  if (Object.keys(templates).length === 0) {
    await migrateToTemplateSystem();
    const fresh = await chrome.storage.local.get("templates");
    return fresh.templates ?? {};
  }

  return templates;
}

async function saveTemplate(template) {
  const templates = await getTemplates();
  const now = Date.now();

  if (!template.id) {
    template = { ...template, id: generateUUID(), createdAt: now };
  }

  templates[template.id] = {
    ...templates[template.id],
    ...template,
    updatedAt: now,
  };

  await chrome.storage.local.set({ templates });
  return templates[template.id];
}

async function deleteTemplate(templateId) {
  const templates = await getTemplates();

  if (Object.keys(templates).length <= 1) {
    throw new Error("至少保留一个模板，无法删除唯一模板。");
  }

  if (!templates[templateId]) {
    throw new Error("模板不存在。");
  }

  const wasDefault = templates[templateId].isDefault;
  delete templates[templateId];

  // 如果删除的是默认模板，将第一个模板设为默认
  if (wasDefault) {
    const firstKey = Object.keys(templates)[0];
    templates[firstKey] = { ...templates[firstKey], isDefault: true };
  }

  await chrome.storage.local.set({ templates });

  // 清理关联的 jobTemplates
  const jtData = await chrome.storage.local.get("jobTemplates");
  const jobTemplates = jtData.jobTemplates ?? {};
  const cleaned = Object.fromEntries(
    Object.entries(jobTemplates).filter(([, v]) => v.templateId !== templateId),
  );
  await chrome.storage.local.set({ jobTemplates: cleaned });
}

async function cloneTemplate(templateId) {
  const templates = await getTemplates();
  const source = templates[templateId];
  if (!source) throw new Error("源模板不存在。");

  const now = Date.now();
  const newId = generateUUID();
  const cloned = {
    ...source,
    id: newId,
    name: `${source.name}（副本）`,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };

  templates[newId] = cloned;
  await chrome.storage.local.set({ templates });
  return cloned;
}

async function getJobTemplate(jobId) {
  const data = await chrome.storage.local.get("jobTemplates");
  const jobTemplates = data.jobTemplates ?? {};
  return jobTemplates[jobId] ?? null;
}

async function setJobTemplate(jobId, templateId) {
  const data = await chrome.storage.local.get("jobTemplates");
  const jobTemplates = data.jobTemplates ?? {};
  jobTemplates[jobId] = {
    templateId,
    confirmedAt: Date.now(),
  };
  await chrome.storage.local.set({ jobTemplates });
}

function matchTemplate(jobTitle, templates) {
  if (!jobTitle) return null;

  const title = jobTitle.toLowerCase();
  let bestMatch = null;
  let bestCount = 0;

  for (const t of Object.values(templates)) {
    if (!t.matchKeywords || t.matchKeywords.length === 0) continue;
    const count = t.matchKeywords.filter((kw) =>
      title.includes(kw.toLowerCase()),
    ).length;
    if (count > bestCount) {
      bestCount = count;
      bestMatch = t;
    }
  }

  return bestMatch;
}

// ── 消息路由 ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "SCORE_RESUME":
      handleScoreResume(message.resumeData, message.jobData, message.templateId)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_SETTINGS":
      getSettings().then((settings) => sendResponse({ ok: true, settings }));
      return true;

    case "SAVE_SETTINGS":
      saveSettings(message.settings)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_SCORES":
      getScores(message.candidateIds)
        .then((scores) => sendResponse({ ok: true, scores }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "TEST_CONNECTION":
      testConnection(message.settings)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "FETCH_JD":
      fetchAndCacheJD(message.jobId, message.origin)
        .then((jobData) => sendResponse({ ok: true, jobData }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "CAPTURE_RESUME_IMAGE":
      captureResumeImage(sender.tab?.id, message.rect, message.dpr ?? 1)
        .then((imageBase64) => sendResponse({ ok: true, imageBase64 }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "OPEN_OPTIONS":
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      break;

    case "SCORE_RESULT":
      sendResponse({ ok: true });
      break;

    // ── 模板系统消息 ──────────────────────────────────────
    case "GET_TEMPLATES":
      getTemplates()
        .then((templates) => sendResponse({ ok: true, templates }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "SAVE_TEMPLATE":
      saveTemplate(message.template)
        .then((template) => sendResponse({ ok: true, template }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "DELETE_TEMPLATE":
      deleteTemplate(message.templateId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "CLONE_TEMPLATE":
      cloneTemplate(message.templateId)
        .then((template) => sendResponse({ ok: true, template }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "GET_JOB_TEMPLATE":
      getJobTemplate(message.jobId)
        .then((result) => sendResponse({ ok: true, jobTemplate: result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "SET_JOB_TEMPLATE":
      setJobTemplate(message.jobId, message.templateId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "MATCH_TEMPLATE":
      getTemplates()
        .then((templates) => {
          const matched = matchTemplate(message.jobTitle, templates);
          sendResponse({ ok: true, template: matched });
        })
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    default:
      sendResponse({
        ok: false,
        error: `Unknown message type: ${message.type}`,
      });
  }
});

// ── LLM 评分 ────────────────────────────────────────────────
async function handleScoreResume(resumeData, jobData, templateId) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error("API Key 未配置，请先在设置页填写。");
  }

  // 解析模板
  const templates = await getTemplates();
  let template;
  if (templateId && templates[templateId]) {
    template = templates[templateId];
  } else {
    // fallback 到默认模板或第一个模板
    template =
      Object.values(templates).find((t) => t.isDefault) ||
      Object.values(templates)[0];
  }

  if (!template) {
    throw new Error("未找到可用的评分模板，请先在设置中创建模板。");
  }

  const prompt = buildPrompt(resumeData, jobData, template);
  const raw = await callLLM(prompt, settings, 0, resumeData.resumeImageBase64 ?? null);
  const result = parseScoreResult(raw, resumeData, jobData, template, settings);

  // 持久化评分
  await saveScore(result);

  return result;
}

function buildPrompt(resumeData, jobData, template) {
  const dimConfig = template.dimensionConfig ?? [];

  // 每行明确写出 key 名，LLM 必须用这些 key 输出 dimensions
  const dims = dimConfig
    .map((d) => `- key="${d.key}"  ${d.label}（权重 ${d.weight}%）：${d.description}`)
    .join("\n");

  // schema 里直接用真实 key，不用占位符
  const dimSchema = dimConfig
    .map((d) => `    "${d.key}": { "score": <0-10整数>, "comment": "<理由>" }`)
    .join(",\n");

  const schema = `{
  "recommendation": "pass" | "hold" | "reject",
  "dimensions": {
${dimSchema}
  },
  "summary": "<100字内综合点评>",
  "highlights": ["<亮点1>", "<亮点2>"],
  "concerns": ["<关注点1>"]
}`;

  if (template.promptTemplate) {
    return template.promptTemplate
      .replace("{jd}", jobData.rawJD)
      .replace("{resume}", JSON.stringify(resumeData, null, 2))
      .replace("{dimensions}", dims);
  }

  return `你是一名专业招聘评估官，具备结构化分析能力。
  你的任务是：基于给定的 JD 和候选人简历，从多个维度进行客观量化评分，并给出详细分析。
  禁止主观臆测，禁止编造简历中未出现的信息。
  所有结论必须基于文本证据。


  ## 任务说明

  请根据【职位描述 JD】与【候选人简历】，对候选人进行多维度评估。

  你必须：
  1. 逐条对比 JD 要求
  2. 从多个维度打分（0-10分）
  3. 给出每个维度的评分理由
  4. 计算加权总分
  5. 判断是否建议进入下一轮
  6. 标记是否触发"硬性条件不满足"

  ---

## 岗位描述
${jobData.rawJD}

## 候选人简历
${JSON.stringify(resumeData, null, 2)}

## 评估维度（请对每个维度打分 0-10）
${dims}

## 输出格式（严格 JSON，dimensionKey 与上方维度 key 对应）
${schema}

评分规则：
- recommendation: 根据各维度综合判断，整体契合度高为 pass，基本符合为 hold，差距较大为 reject
- 每个 highlights/concerns 控制在 1 句话内`;
}

// 最大重试次数和可重试的 HTTP 状态码
const MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// 检测模型能力：o1/o3/o4/gpt-5 等新系列有差异
function modelCaps(model) {
  const m = model.toLowerCase();
  // 推理模型或新一代模型：不支持 temperature，用 max_completion_tokens
  const isNewGen = /^o\d/.test(m) || m.includes("gpt-5") || m.includes("o4-");
  return {
    maxTokensParam: isNewGen ? "max_completion_tokens" : "max_tokens",
    supportsTemperature: !isNewGen,
    supportsJsonFormat: !isNewGen && !m.includes("azure"),
  };
}

async function callLLM(userPrompt, settings, retryCount = 0, imageBase64 = null) {
  const caps = modelCaps(settings.model);

  // 截断过长输入，避免挤压输出 token 空间（保留约 80000 tokens 给输入，其余给输出）
  const MAX_INPUT_CHARS = 80000;
  const truncatedPrompt =
    userPrompt.length > MAX_INPUT_CHARS
      ? userPrompt.slice(0, MAX_INPUT_CHARS) +
        "\n\n[...内容已截断，请基于以上内容评分]"
      : userPrompt;

  // 视觉模式：简历截图作为图片消息内容
  const userContent = imageBase64
    ? [
        {
          type: "text",
          text: "候选人简历文本提取不完整，已附上简历截图，请结合图片内容进行评估。\n\n" +
                truncatedPrompt,
        },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${imageBase64}` },
        },
      ]
    : truncatedPrompt;

  let response;
  try {
    const body = {
      model: settings.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_DEFAULT },
        { role: "user", content: userContent },
      ],
      [caps.maxTokensParam]: 30000,
    };
    if (caps.supportsTemperature) body.temperature = 0.3;
    // response_format: json_object 在 finish_reason=length 时可能返回空 content，谨慎启用
    if (caps.supportsJsonFormat) body.response_format = { type: "json_object" };

    console.log("[CVFilterX] LLM 请求", {
      model: body.model,
      maxTokensParam: caps.maxTokensParam,
      maxTokens: body[caps.maxTokensParam],
      supportsJsonFormat: caps.supportsJsonFormat,
      visionMode: !!imageBase64,
      inputChars: truncatedPrompt.length,
      promptPreview:
        truncatedPrompt.slice(0, 3000) +
        (truncatedPrompt.length > 3000 ? "..." : ""),
    });

    response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    if (retryCount < MAX_RETRIES) {
      await sleep(1000 * (retryCount + 1));
      return callLLM(userPrompt, settings, retryCount + 1, imageBase64);
    }
    throw new Error(
      `网络请求失败（已重试 ${retryCount} 次）：${networkErr.message}`,
    );
  }

  // 限流：等待 Retry-After 或指数退避后重试
  if (response.status === 429 && retryCount < MAX_RETRIES) {
    const retryAfter =
      parseInt(response.headers.get("Retry-After") ?? "0") || 5;
    await sleep(Math.min(retryAfter, 30) * 1000);
    return callLLM(userPrompt, settings, retryCount + 1, imageBase64);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (RETRYABLE_STATUS.has(response.status) && retryCount < MAX_RETRIES) {
      await sleep(1500 * (retryCount + 1));
      return callLLM(userPrompt, settings, retryCount + 1, imageBase64);
    }
    // 解析错误信息（OpenAI 格式）
    let errMsg = `HTTP ${response.status}`;
    try {
      const errJson = JSON.parse(body);
      errMsg = errJson?.error?.message ?? errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  const data = await response.json();
  const msg = data.choices?.[0]?.message;
  const finishReason = data.choices?.[0]?.finish_reason ?? "unknown";

  console.log("[CVFilterX] LLM 响应", {
    finish_reason: finishReason,
    usage: data.usage,
    contentLength: msg?.content?.length ?? 0,
    contentPreview: (msg?.content ?? "").slice(0, 3000),
  });

  // 兼容各种 content 位置
  const content =
    msg?.content ?? // 标准 OpenAI
    msg?.reasoning_content ?? // 部分推理模型
    data.choices?.[0]?.text ?? // 老版 completions 格式
    null;

  if (!content) {
    console.error(
      "[CVFilterX] 异常响应结构:",
      JSON.stringify({
        finish_reason: finishReason,
        message_keys: msg ? Object.keys(msg) : null,
        data_keys: Object.keys(data),
        usage: data.usage,
      }),
    );

    // finish_reason=length 且无内容：可能是 response_format=json_object 被截断导致
    // 去掉 json_object 约束重试一次
    if (
      finishReason === "length" &&
      retryCount < MAX_RETRIES &&
      caps.supportsJsonFormat
    ) {
      console.warn(
        "[CVFilterX] json_object 截断导致内容为空，去掉格式约束重试...",
      );
      const bodyNoFormat = {
        model: settings.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT_DEFAULT },
          { role: "user", content: truncatedPrompt },
        ],
        [caps.maxTokensParam]: 30000,
      };
      if (caps.supportsTemperature) bodyNoFormat.temperature = 0.3;
      const retryResp = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(bodyNoFormat),
      });
      if (retryResp.ok) {
        const retryData = await retryResp.json();
        const retryContent = retryData.choices?.[0]?.message?.content ?? null;
        if (retryContent) return retryContent;
      }
    }

    throw new Error(`API 返回内容为空 (finish_reason: ${finishReason})`);
  }
  return content;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 简历截图（内容不足时的图片 fallback）────────────────────
// 捕获当前 tab 可见区域，裁剪至简历面板的 bounding rect
async function captureResumeImage(_tabId, rect, dpr) {
  // 捕获整个可见区（PNG data URL）
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });

  // 用 fetch 将 data URL 转为 Blob，再创建 ImageBitmap 用于裁剪
  const blob = await (await fetch(dataUrl)).blob();
  const imgBitmap = await createImageBitmap(blob);

  // 将 CSS 像素坐标转换为物理像素坐标
  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.min(Math.round(rect.width * dpr), imgBitmap.width - sx);
  const sh = Math.min(Math.round(rect.height * dpr), imgBitmap.height - sy);

  // 尺寸无效时 fallback 到完整截图
  if (sw <= 0 || sh <= 0) {
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  }

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imgBitmap, -sx, -sy);

  const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
  const buf = await croppedBlob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function parseScoreResult(raw, resumeData, jobData, template, settings) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 尝试从字符串中提取 JSON
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match)
      throw new Error(`LLM 返回内容无法解析为 JSON：${raw.slice(0, 200)}`);
    parsed = JSON.parse(match[0]);
  }

  const rawDimensions = parsed.dimensions ?? {};

  // 在代码里计算综合分，不依赖 LLM 输出（避免模型算错或输出 0）
  const dimConfig = template.dimensionConfig ?? [];
  let overallScore = 0;
  let totalWeight = 0;

  // 将模板的维度元数据合并到 LLM 输出中，供 overlay 渲染可读 label
  const dimensions = {};
  for (const d of dimConfig) {
    const raw = rawDimensions[d.key];
    const score = raw?.score;
    if (typeof score === "number") {
      overallScore += score * d.weight;
      totalWeight += d.weight;
    }
    if (raw) {
      dimensions[d.key] = {
        ...raw,
        label: d.label,
        weight: d.weight,
      };
    }
  }
  // 保留 LLM 输出中可能存在但模板未定义的维度
  for (const key of Object.keys(rawDimensions)) {
    if (!dimensions[key]) {
      dimensions[key] = rawDimensions[key];
    }
  }

  // 归一化到 100 分制：Sigma(score*weight) / 10，若没有任何维度数据则为 0
  overallScore = totalWeight > 0 ? Math.round(overallScore / 10) : 0;

  return {
    candidateId: resumeData.candidateId,
    jobId: jobData.jobId,
    scoredAt: Date.now(),
    recommendation: parsed.recommendation ?? "hold",
    dimensions,
    overallScore,
    summary: parsed.summary ?? "",
    highlights: parsed.highlights ?? [],
    concerns: parsed.concerns ?? [],
    modelUsed: settings.model ?? "unknown",
    promptVersion: "v2-template",
    templateId: template.id,
    templateName: template.name,
  };
}

// ── API 连通性测试 ───────────────────────────────────────────
async function testConnection(settings) {
  const response = await fetch(`${settings.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${settings.apiKey}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${body.slice(0, 100)}`);
  }
  return "连接成功";
}

// ── Storage 工具函数 ─────────────────────────────────────────
async function getSettings() {
  const data = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
}

async function saveSettings(partial) {
  const current = await getSettings();
  await chrome.storage.local.set({ settings: { ...current, ...partial } });
}

async function saveScore(result) {
  const data = await chrome.storage.local.get("scores");
  const scores = data.scores ?? {};
  scores[result.candidateId] = result;
  await chrome.storage.local.set({ scores });
}

async function getScores(candidateIds) {
  const data = await chrome.storage.local.get("scores");
  const scores = data.scores ?? {};
  if (!candidateIds) return scores;
  return Object.fromEntries(candidateIds.map((id) => [id, scores[id] ?? null]));
}

async function saveJobData(jobData) {
  const data = await chrome.storage.local.get("jobs");
  const jobs = data.jobs ?? {};
  jobs[jobData.jobId] = jobData;
  await chrome.storage.local.set({ jobs });
}

// ── JD 页面抓取（在 background 中打开新 Tab，注入脚本提取）────
async function fetchAndCacheJD(jobId, origin) {
  const jobUrl = `${origin}/hire/job/${jobId}?activeTab=basicInfo`;

  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: jobUrl, active: false }, (newTab) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }

      let settled = false;

      const cleanup = () => {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.remove(newTab.id).catch(() => {});
      };

      // 超时保护（20s）
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("fetchAndCacheJD timeout"));
      }, 20000);

      const listener = async (tabId, info) => {
        if (tabId !== newTab.id || info.status !== "complete") return;
        chrome.tabs.onUpdated.removeListener(listener);

        // 等待 SPA 渲染（最多重试 5 次，每次 1s）
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: newTab.id },
            func: async () => {
              for (let i = 0; i < 5; i++) {
                const panels = document.querySelectorAll(
                  ".job-showcase-panel-item",
                );
                for (const p of panels) {
                  const t = p.innerText || "";
                  if (t.includes("职位描述") || t.includes("职位名称")) {
                    const lines = t
                      .split(/\n/)
                      .map((l) => l.trim())
                      .filter(Boolean);
                    const idx = lines.indexOf("职位名称");
                    const title = idx >= 0 ? lines[idx + 1] : "";
                    return { rawJD: t, jobTitle: title };
                  }
                }
                if (i < 4) await new Promise((r) => setTimeout(r, 1000));
              }
              return null;
            },
          });

          if (settled) return;
          settled = true;
          clearTimeout(timer);

          const jdData = results?.[0]?.result;
          if (jdData?.rawJD) {
            const jobData = {
              jobId,
              jobTitle: jdData.jobTitle || "未知职位",
              rawJD: jdData.rawJD,
              capturedAt: Date.now(),
            };
            await saveJobData(jobData);
            cleanup();
            resolve(jobData);
          } else {
            cleanup();
            reject(new Error("JD 内容未找到，页面可能尚未渲染"));
          }
        } catch (e) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cleanup();
          reject(e);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}
