/**
 * CVFilterX - Content Script 主入口
 *
 * 支持三种页面：
 *   candidate_detail  /hire/talent/{id}   -> 挂载浮层，支持手动/自动评分
 *   job_detail        /hire/job/{id}      -> 自动提取并缓存 JD
 *   candidate_list    /hire/application-biz/evaluation/list -> 收集候选人链接
 */

const cvfx = window.__cvfx;

let currentTalentId = null;

// ── 初始化 ────────────────────────────────────────────────────
async function init() {
  const pageType = cvfx.detectPageType();
  console.log(`[CVFilterX] 页面类型: ${pageType}  URL: ${location.pathname}`);

  switch (pageType) {
    case 'candidate_detail': await onCandidateDetailPage(); break;
    case 'job_detail':       await onJobDetailPage();       break;
    case 'candidate_list':   await onCandidateListPage();   break;
  }
}

// ── 候选人详情页 ──────────────────────────────────────────────
async function onCandidateDetailPage() {
  // 等待候选人元素渲染
  try {
    await cvfx.waitForElement(cvfx.SELECTORS.candidate.talentEl, 10000);
  } catch {
    console.warn('[CVFilterX] 候选人元素等待超时');
    return;
  }

  // 防止 SPA 路由重复触发
  const talentId = location.pathname.match(cvfx.URL_PATTERNS.talentId)?.[1];
  if (talentId === currentTalentId) return;
  currentTalentId = talentId;

  // 挂载浮层
  cvfx.mountOverlay();

  const settings = await getSettings();

  // 批量模式：自动评分
  if (await cvfx.isBatchRunning()) {
    const cached = await getCachedScore(talentId, settings);
    if (cached && settings.skipScored !== false) {
      console.log(`[CVFilterX] 跳过已评分: ${talentId}`);
      cvfx.renderOverlay('scored', { result: cached });
      await cvfx.onScoreComplete(cached);
      return;
    }

    // 批量模式下从 taskState 读取模板 ID
    const taskState = await cvfx.getTaskState();
    const batchTemplateId = taskState?.templateId || null;

    await scoreCandidate(settings, batchTemplateId, (result, err) => {
      if (err) cvfx.onScoreError(err.message);
      else     cvfx.onScoreComplete(result);
    });
    return;
  }

  // 手动模式：检查缓存或显示 idle
  const cached = await getCachedScore(talentId, settings);
  if (cached) {
    cvfx.renderOverlay('scored', { result: cached });
  } else {
    cvfx.renderOverlay('idle');
  }
}

// ── JD 详情页（自动提取并缓存）───────────────────────────────
async function onJobDetailPage() {
  try {
    // 等待 job-showcase-panel-item 渲染
    await cvfx.waitForElement('.job-showcase-panel-item', 8000);
  } catch {
    return;
  }

  const jobData = cvfx.extractJobData();
  if (!jobData.rawJD.includes('[JD 提取失败')) {
    await cacheJobData(jobData);
    console.log(`[CVFilterX] JD 已缓存: ${jobData.jobTitle} (${jobData.jobId})`);
  }
}

// ── 评估列表页 ────────────────────────────────────────────────
async function onCandidateListPage() {
  console.log('[CVFilterX] 评估列表页就绪');

  // 等待 API 数据就绪（评估列表用 Canvas 渲染，无 DOM 可查）
  try {
    await cvfx.waitForEvalList(10000);
  } catch {
    console.warn('[CVFilterX] 评估列表 API 数据等待超时，将尝试 DOM 降级');
    try {
      await cvfx.waitForElement(
        ['[data-talent-id]', 'a[href*="/hire/talent/"]'],
        3000
      );
    } catch { /* 超时不阻断后续逻辑 */ }
  }

  // 从过滤标签 / URL 参数提取职位信息缓存，供 Popup 展示
  const jobData = cvfx.extractJobFromEvalList?.();
  if (jobData?.jobTitle) {
    await cacheJobData(jobData);
    console.log(`[CVFilterX] 从评估列表提取到职位: ${jobData.jobTitle}`);
  }

  // 输出诊断：当前找到多少候选人链接
  const count = cvfx.collectCandidateLinks?.().length ?? 0;
  console.log(`[CVFilterX] 评估列表候选人数: ${count}`);
}

// ── 评分核心流程 ──────────────────────────────────────────────
async function scoreCandidate(settings, explicitTemplateId, afterScore) {
  if (!settings.apiKey) {
    cvfx.renderOverlay('error', { error: 'API Key 未配置，请打开设置页填写。' });
    chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    if (afterScore) afterScore(null, new Error('API Key 未配置'));
    return;
  }

  // 确定模板 ID
  let templateId = explicitTemplateId;

  if (!templateId) {
    // 检查 jobTemplates 关联
    const resumeData = cvfx.extractResumeData(settings.fieldConfig);
    const jobId = resumeData.jobId;
    if (jobId) {
      const jtRes = await chrome.runtime.sendMessage({ type: 'GET_JOB_TEMPLATE', jobId });
      if (jtRes?.ok && jtRes.jobTemplate) {
        templateId = jtRes.jobTemplate.templateId;
      }
    }

    // 如果还没有，弹出模板选择对话框
    if (!templateId) {
      const tplRes = await chrome.runtime.sendMessage({ type: 'GET_TEMPLATES' });
      if (!tplRes?.ok) {
        cvfx.renderOverlay('error', { error: '加载模板失败' });
        if (afterScore) afterScore(null, new Error('加载模板失败'));
        return;
      }

      const templates = tplRes.templates;
      const tplList = Object.values(templates);

      if (tplList.length === 1) {
        // 只有一个模板，直接使用
        templateId = tplList[0].id;
      } else {
        // 尝试匹配
        const jobTitle = document.querySelector(cvfx.SELECTORS.candidate.jobInfo)?.innerText?.split('\n')[0] || '';
        let suggested = null;
        if (jobTitle) {
          const matchRes = await chrome.runtime.sendMessage({ type: 'MATCH_TEMPLATE', jobTitle });
          if (matchRes?.ok && matchRes.template) {
            suggested = matchRes.template;
          }
        }

        // 弹出对话框
        const chosen = await showTemplateDialog(jobTitle, tplList, suggested);
        if (!chosen) {
          cvfx.renderOverlay('idle');
          if (afterScore) afterScore(null, new Error('用户取消选择模板'));
          return;
        }
        templateId = chosen;
      }

      // 保存关联
      const jd = cvfx.extractResumeData(settings.fieldConfig);
      if (jd.jobId) {
        await chrome.runtime.sendMessage({
          type: 'SET_JOB_TEMPLATE',
          jobId: jd.jobId,
          templateId,
        });
      }
    }
  }

  cvfx.renderOverlay('loading');

  try {
    const resumeData = cvfx.extractResumeData(settings.fieldConfig);

    // 图片 fallback：简历文本不足时截图提交给 LLM（视觉模型）
    if ((resumeData.resumeText ?? '').length < 100) {
      try {
        const imageBase64 = await captureResumeImage();
        if (imageBase64) {
          resumeData.resumeImageBase64 = imageBase64;
          console.log('[CVFilterX] 简历文本不足，已截图作为 fallback');
        }
      } catch (e) {
        console.warn('[CVFilterX] 简历截图失败:', e.message);
      }
    }

    const jobData = await getJobData(resumeData.jobId);

    const response = await chrome.runtime.sendMessage({
      type: 'SCORE_RESUME',
      resumeData,
      jobData,
      templateId,
    });

    if (!response.ok) throw new Error(response.error);

    cvfx.renderOverlay('scored', { result: response.result });
    chrome.runtime.sendMessage({ type: 'SCORE_RESULT', result: response.result }).catch(() => {});
    if (afterScore) afterScore(response.result, null);
  } catch (err) {
    console.error('[CVFilterX] 评分失败', err);
    cvfx.renderOverlay('error', { error: err.message });
    if (afterScore) afterScore(null, err);
  }
}

// ── 模板选择对话框 ────────────────────────────────────────────
function showTemplateDialog(jobTitle, templates, suggested) {
  return new Promise((resolve) => {
    // 移除可能存在的旧对话框
    document.getElementById('cvfx-template-dialog')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'cvfx-template-dialog';
    overlay.innerHTML = `
      <div class="cvfx-tpl-backdrop"></div>
      <div class="cvfx-tpl-panel">
        <div class="cvfx-tpl-title">选择评分模板</div>
        ${jobTitle ? `<div class="cvfx-tpl-subtitle">当前岗位：${escHtml(jobTitle)}</div>` : ''}
        <div class="cvfx-tpl-list">
          ${templates.map(t => {
            const isSuggested = suggested && t.id === suggested.id;
            return `
              <label class="cvfx-tpl-option${isSuggested ? ' suggested' : ''}">
                <input type="radio" name="cvfx-tpl" value="${t.id}" ${isSuggested ? 'checked' : ''}>
                <div class="cvfx-tpl-info">
                  <span class="cvfx-tpl-name">${escHtml(t.name)}</span>
                  ${isSuggested ? '<span class="cvfx-tpl-tag">推荐</span>' : ''}
                  ${t.isDefault ? '<span class="cvfx-tpl-tag default">默认</span>' : ''}
                  <span class="cvfx-tpl-desc">${escHtml(t.description || '')}</span>
                </div>
              </label>
            `;
          }).join('')}
        </div>
        <div class="cvfx-tpl-actions">
          <button class="cvfx-tpl-btn cancel">取消</button>
          <button class="cvfx-tpl-btn confirm">确认</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cleanup = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector('.cvfx-tpl-backdrop').addEventListener('click', () => cleanup(null));
    overlay.querySelector('.cvfx-tpl-btn.cancel').addEventListener('click', () => cleanup(null));
    overlay.querySelector('.cvfx-tpl-btn.confirm').addEventListener('click', () => {
      const selected = overlay.querySelector('input[name="cvfx-tpl"]:checked');
      cleanup(selected?.value || null);
    });
  });
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── 简历截图（文本不足时的图片 fallback）─────────────────────
async function captureResumeImage() {
  const sel = cvfx.SELECTORS.candidate.resumeTabContent;
  const el = document.querySelector(sel);
  if (!el) return null;

  // 滚动到元素顶部，等待渲染稳定
  el.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  await new Promise(r => setTimeout(r, 400));

  const rect = el.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;

  const res = await chrome.runtime.sendMessage({
    type: 'CAPTURE_RESUME_IMAGE',
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    dpr,
  });

  if (!res?.ok) throw new Error(res?.error ?? 'captureVisibleTab failed');
  return res.imageBase64;
}

// ── JD 获取（优先缓存，fallback 请求 background 抓取 JD 页）──
async function getJobData(jobId) {
  if (jobId) {
    const d = await chrome.storage.local.get('jobs');
    const jobs = d.jobs ?? {};
    const cached = jobs[jobId];
    if (cached && isFresh(cached.capturedAt, 7) && cached.rawJD && !cached.partial) return cached;
  }

  // Fallback：用候选人页的岗位信息作为简要 JD
  const jobEl = document.querySelector(cvfx.SELECTORS.candidate.jobInfo);
  const briefJobText = jobEl?.innerText?.trim() || '';

  if (jobId) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'FETCH_JD',
        jobId,
        origin: location.origin,
      });
      if (res?.ok && res.jobData) return res.jobData;
    } catch {}
    const d = await chrome.storage.local.get('jobs');
    if (d.jobs?.[jobId]) return d.jobs[jobId];
  }

  return {
    jobId: jobId || 'unknown',
    jobTitle: briefJobText.split('\n')[0] || '未知职位',
    rawJD: briefJobText || '[未找到 JD，请先访问职位详情页]',
    capturedAt: Date.now(),
  };
}

// ── 工具函数 ──────────────────────────────────────────────────
async function getSettings() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  return res?.settings ?? {};
}

async function getCachedScore(talentId, settings) {
  if (!talentId) return null;
  const d = await chrome.storage.local.get('scores');
  const score = d.scores?.[talentId];
  if (!score) return null;
  const days = settings.cacheExpireDays ?? 7;
  if (days > 0 && !isFresh(score.scoredAt, days)) return null;
  return score;
}

async function cacheJobData(jobData) {
  const d = await chrome.storage.local.get('jobs');
  const jobs = d.jobs ?? {};
  jobs[jobData.jobId] = jobData;
  await chrome.storage.local.set({ jobs });
}

function isFresh(ts, days) {
  return Date.now() - ts < days * 24 * 60 * 60 * 1000;
}

// ── 事件监听 ──────────────────────────────────────────────────

// 浮层「开始评分」按钮
document.addEventListener('cvfx:score-request', async () => {
  const settings = await getSettings();
  await scoreCandidate(settings, null, null);
});

// Popup / Background 消息
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'START_BATCH':
      cvfx.startBatch(msg.templateId)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'STOP_BATCH':
      cvfx.stopBatch().then(() => sendResponse({ ok: true }));
      return true;

    case 'GET_PAGE_TYPE':
      sendResponse({ pageType: cvfx.detectPageType() });
      break;

    case 'GET_CANDIDATE_COUNT': {
      const links = cvfx.collectCandidateLinks?.() ?? [];
      sendResponse({ count: links.length });
      break;
    }
  }
});

// SPA 路由变化（飞书是 History API）
let lastPath = location.pathname + location.search;

function handleRouteChange() {
  const cur = location.pathname + location.search;
  if (cur !== lastPath) {
    lastPath = cur;
    currentTalentId = null;
    setTimeout(init, 400);
  }
}

const _push    = history.pushState.bind(history);
const _replace = history.replaceState.bind(history);
history.pushState    = (...a) => { _push(...a);    handleRouteChange(); };
history.replaceState = (...a) => { _replace(...a); handleRouteChange(); };
window.addEventListener('popstate', handleRouteChange);

// ── 启动 ──────────────────────────────────────────────────────
init();
