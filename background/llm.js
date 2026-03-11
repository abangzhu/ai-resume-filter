/**
 * CVFilterX - LLM Integration
 * callLLM, buildPrompt, parseScoreResult, modelCaps, handleScoreResume
 */

// 最大重试次数和可重试的 HTTP 状态码
const MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// 检测模型能力：o1/o3/o4/gpt-5 等新系列有差异
function modelCaps(model) {
  const m = model.toLowerCase();
  const isNewGen = /^o\d/.test(m) || m.includes('gpt-5') || m.includes('o4-');
  return {
    maxTokensParam: isNewGen ? 'max_completion_tokens' : 'max_tokens',
    supportsTemperature: !isNewGen,
    supportsJsonFormat: !isNewGen && !m.includes('azure'),
  };
}

async function handleScoreResume(resumeData, jobData, templateId) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error('API Key 未配置，请先在设置页填写。');
  }

  const templates = await getTemplates();
  let template;
  if (templateId && templates[templateId]) {
    template = templates[templateId];
  } else {
    template =
      Object.values(templates).find((t) => t.isDefault) ||
      Object.values(templates)[0];
  }

  if (!template) {
    throw new Error('未找到可用的评分模板，请先在设置中创建模板。');
  }

  const prompt = buildPrompt(resumeData, jobData, template);
  const resumeTextLength = (resumeData.resumeText ?? '').length;
  const raw = await callLLM(prompt, settings, 0, resumeData.resumeImageBase64 ?? null, resumeTextLength);
  const result = parseScoreResult(raw, resumeData, jobData, template, settings);

  await saveScore(result);

  return result;
}

function buildPrompt(resumeData, jobData, template) {
  const dimConfig = template.dimensionConfig ?? [];

  const dims = dimConfig
    .map((d) => `- key="${d.key}"  ${d.label}（权重 ${d.weight}%）：${d.description}`)
    .join('\n');

  const dimSchema = dimConfig
    .map((d) => `    "${d.key}": { "score": <0-10整数>, "comment": "<理由>" }`)
    .join(',\n');

  const schema = `{
  "recommendation": "pass" | "hold" | "reject",
  "dimensions": {
${dimSchema}
  },
  "summary": "<100字内综合点评>",
  "highlights": ["<亮点1>", "<亮点2>"],
  "concerns": ["<关注点1>"]
}`;

  // 向后兼容：旧模板使用 promptTemplate 字符串替换
  if (template.promptTemplate) {
    return template.promptTemplate
      .replace('{jd}', jobData.rawJD)
      .replace('{resume}', JSON.stringify(resumeData, null, 2))
      .replace('{dimensions}', dims);
  }

  // 新模式：从 promptSections 取各区块，fallback 到内置默认值
  const sections = template.promptSections ?? {};
  const role = sections.roleSetup ?? PROMPT_SECTION_DEFAULTS.roleSetup;
  const task = sections.taskGuide ?? PROMPT_SECTION_DEFAULTS.taskGuide;
  const rules = sections.outputRules ?? PROMPT_SECTION_DEFAULTS.outputRules;

  return `${role}

## 任务说明

${task}

---

## 岗位描述
${jobData.rawJD}

## 候选人简历
${JSON.stringify(resumeData, null, 2)}

## 评估维度（请对每个维度打分 0-10）
${dims}

## 输出格式（严格 JSON，dimensionKey 与上方维度 key 对应）
${schema}

${rules}`;
}

async function callLLM(userPrompt, settings, retryCount = 0, imageBase64 = null, resumeTextLength = 0) {
  const caps = modelCaps(settings.model);

  const MAX_INPUT_CHARS = 80000;
  const truncatedPrompt =
    userPrompt.length > MAX_INPUT_CHARS
      ? userPrompt.slice(0, MAX_INPUT_CHARS) +
        '\n\n[...内容已截断，请基于以上内容评分]'
      : userPrompt;

  let userContent;
  if (imageBase64) {
    const preamble = resumeTextLength > 500
      ? '已附上简历截图作为补充参考，请以文本内容为主、结合图片进行评估。'
      : '候选人简历文本提取不完整，已附上简历截图，请以图片内容为主进行评估。';
    userContent = [
      {
        type: 'text',
        text: preamble + '\n\n' + truncatedPrompt,
      },
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${imageBase64}` },
      },
    ];
  } else {
    userContent = truncatedPrompt;
  }

  let response;
  try {
    const body = {
      model: settings.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_DEFAULT },
        { role: 'user', content: userContent },
      ],
      [caps.maxTokensParam]: 30000,
    };
    if (caps.supportsTemperature) body.temperature = 0.3;
    if (caps.supportsJsonFormat) body.response_format = { type: 'json_object' };

    console.log('[CVFilterX] LLM 请求', {
      model: body.model,
      maxTokensParam: caps.maxTokensParam,
      maxTokens: body[caps.maxTokensParam],
      supportsJsonFormat: caps.supportsJsonFormat,
      visionMode: !!imageBase64,
      inputChars: truncatedPrompt.length,
      promptPreview:
        truncatedPrompt.slice(0, 3000) +
        (truncatedPrompt.length > 3000 ? '...' : ''),
    });

    response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    if (retryCount < MAX_RETRIES) {
      await sleep(1000 * (retryCount + 1));
      return callLLM(userPrompt, settings, retryCount + 1, imageBase64, resumeTextLength);
    }
    throw new Error(
      `网络请求失败（已重试 ${retryCount} 次）：${networkErr.message}`,
    );
  }

  if (response.status === 429 && retryCount < MAX_RETRIES) {
    const retryAfter =
      parseInt(response.headers.get('Retry-After') ?? '0') || 5;
    await sleep(Math.min(retryAfter, 30) * 1000);
    return callLLM(userPrompt, settings, retryCount + 1, imageBase64, resumeTextLength);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (RETRYABLE_STATUS.has(response.status) && retryCount < MAX_RETRIES) {
      await sleep(1500 * (retryCount + 1));
      return callLLM(userPrompt, settings, retryCount + 1, imageBase64, resumeTextLength);
    }
    let errMsg = `HTTP ${response.status}`;
    try {
      const errJson = JSON.parse(body);
      errMsg = errJson?.error?.message ?? errMsg;
    } catch { /* ignore parse error */ }
    throw new Error(errMsg);
  }

  const data = await response.json();
  const msg = data.choices?.[0]?.message;
  const finishReason = data.choices?.[0]?.finish_reason ?? 'unknown';

  console.log('[CVFilterX] LLM 响应', {
    finish_reason: finishReason,
    usage: data.usage,
    contentLength: msg?.content?.length ?? 0,
    contentPreview: (msg?.content ?? '').slice(0, 3000),
  });

  const content =
    msg?.content ??
    msg?.reasoning_content ??
    data.choices?.[0]?.text ??
    null;

  if (!content) {
    console.error(
      '[CVFilterX] 异常响应结构:',
      JSON.stringify({
        finish_reason: finishReason,
        message_keys: msg ? Object.keys(msg) : null,
        data_keys: Object.keys(data),
        usage: data.usage,
      }),
    );

    if (
      finishReason === 'length' &&
      retryCount < MAX_RETRIES &&
      caps.supportsJsonFormat
    ) {
      console.warn(
        '[CVFilterX] json_object 截断导致内容为空，去掉格式约束重试...',
      );
      const bodyNoFormat = {
        model: settings.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT_DEFAULT },
          { role: 'user', content: truncatedPrompt },
        ],
        [caps.maxTokensParam]: 30000,
      };
      if (caps.supportsTemperature) bodyNoFormat.temperature = 0.3;
      const retryResp = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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

function parseScoreResult(raw, resumeData, jobData, template, settings) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match)
      throw new Error(`LLM 返回内容无法解析为 JSON：${raw.slice(0, 200)}`);
    parsed = JSON.parse(match[0]);
  }

  const rawDimensions = parsed.dimensions ?? {};

  const dimConfig = template.dimensionConfig ?? [];
  let overallScore = 0;
  let totalWeight = 0;

  const dimensions = {};
  for (const d of dimConfig) {
    const rawDim = rawDimensions[d.key];
    const score = rawDim?.score;
    if (typeof score === 'number') {
      overallScore += score * d.weight;
      totalWeight += d.weight;
    }
    if (rawDim) {
      dimensions[d.key] = {
        ...rawDim,
        label: d.label,
        weight: d.weight,
      };
    }
  }
  for (const key of Object.keys(rawDimensions)) {
    if (!dimensions[key]) {
      dimensions[key] = rawDimensions[key];
    }
  }

  overallScore = totalWeight > 0 ? Math.round(overallScore / 10) : 0;

  return {
    candidateId: resumeData.candidateId,
    jobId: jobData.jobId,
    scoredAt: Date.now(),
    recommendation: parsed.recommendation ?? 'hold',
    dimensions,
    overallScore,
    summary: parsed.summary ?? '',
    highlights: parsed.highlights ?? [],
    concerns: parsed.concerns ?? [],
    modelUsed: settings.model ?? 'unknown',
    promptVersion: 'v2-template',
    templateId: template.id,
    templateName: template.name,
    resumeSource: resumeData.resumeSource ?? null,
  };
}
