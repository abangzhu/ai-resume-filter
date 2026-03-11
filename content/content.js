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
cvfx.pageReady = false;

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
  try {
    await cvfx.waitForElement(cvfx.SELECTORS.candidate.talentEl, 10000);
  } catch {
    console.warn('[CVFilterX] 候选人元素等待超时');
    return;
  }

  const talentId = location.pathname.match(cvfx.URL_PATTERNS.talentId)?.[1];
  if (talentId === currentTalentId) return;
  currentTalentId = talentId;

  cvfx.mountOverlay();

  // 先渲染未就绪的 idle 状态
  cvfx.pageReady = false;

  const settings = await cvfxGetSettings();

  // 批量模式
  if (await cvfx.isBatchRunning()) {
    const cached = await cvfxGetCachedScore(talentId, settings);
    if (cached && settings.skipScored !== false) {
      console.log(`[CVFilterX] 跳过已评分: ${talentId}`);
      cvfx.renderOverlay('scored', { result: cached });
      await cvfx.onScoreComplete(cached);
      return;
    }

    const taskState = await cvfx.getTaskState();
    const batchTemplateId = taskState?.templateId || null;

    await scoreCandidate(settings, batchTemplateId, (result, err) => {
      if (err) cvfx.onScoreError(err.message);
      else     cvfx.onScoreComplete(result);
    });
    return;
  }

  // 手动模式：先显示未就绪 idle，等简历面板出现后标记就绪
  const templateInfo = await getCurrentTemplateInfo(settings);
  const cached = await cvfxGetCachedScore(talentId, settings);
  if (cached) {
    const cachedWithRank = await attachRankInfo(cached);
    cvfx.pageReady = true;
    cvfx.renderOverlay('scored', { result: cachedWithRank });
  } else {
    cvfx.renderOverlay('idle', { templateName: templateInfo?.name, pageReady: false });
    // 非阻塞等待简历面板出现
    try {
      await cvfx.waitForElement(cvfx.SELECTORS.candidate.resumeTabContent, 8000);
    } catch { /* 超时不阻断 */ }
    cvfx.pageReady = true;
    cvfx.renderOverlay('idle', { templateName: templateInfo?.name, pageReady: true });
  }
}

// ── JD 详情页 ────────────────────────────────────────────────
async function onJobDetailPage() {
  try {
    await cvfx.waitForElement('.job-showcase-panel-item', 8000);
  } catch {
    return;
  }

  const jobData = cvfx.extractJobData();
  if (!jobData.rawJD.includes('[JD 提取失败')) {
    await cvfxCacheJobData(jobData);
    console.log(`[CVFilterX] JD 已缓存: ${jobData.jobTitle} (${jobData.jobId})`);
  }
}

// ── 评估列表页 ────────────────────────────────────────────────
async function onCandidateListPage() {
  console.log('[CVFilterX] 评估列表页就绪');

  try {
    await cvfx.waitForEvalList(10000);
  } catch {
    console.warn('[CVFilterX] 评估列表 API 数据等待超时，将尝试 DOM 降级');
    try {
      await cvfx.waitForElement(['[data-talent-id]', 'a[href*="/hire/talent/"]'], 3000);
    } catch { /* 超时不阻断 */ }
  }

  const jobData = cvfx.extractJobFromEvalList?.();
  if (jobData?.jobTitle) {
    await cvfxCacheJobData(jobData);
    console.log(`[CVFilterX] 从评估列表提取到职位: ${jobData.jobTitle}`);
  }

  const count = cvfx.collectCandidateLinks?.().length ?? 0;
  console.log(`[CVFilterX] 评估列表候选人数: ${count}`);

  cvfx.pageReady = true;
}

// ── 事件监听 ──────────────────────────────────────────────────

document.addEventListener('cvfx:score-request', async () => {
  const settings = await cvfxGetSettings();
  await scoreCandidate(settings, null, null);
});

document.addEventListener('cvfx:switch-template', async () => {
  let tplRes;
  try { tplRes = await sendMsg(MSG.GET_TEMPLATES); }
  catch { return; }

  const templates = tplRes.templates;
  const tplList = Object.values(templates);
  if (tplList.length === 0) return;

  const jobTitle = document.querySelector(cvfx.SELECTORS.candidate.jobInfo)?.innerText?.split('\n')[0] || '';
  let suggested = null;
  if (jobTitle) {
    try {
      const matchRes = await sendMsg(MSG.MATCH_TEMPLATE, { jobTitle });
      if (matchRes?.template) suggested = matchRes.template;
    } catch { /* ignore */ }
  }

  const chosen = await showTemplateDialog(jobTitle, tplList, suggested);
  if (!chosen) return;

  const settings = await cvfxGetSettings();
  const resumeData = cvfx.extractResumeData(settings.fieldConfig);
  if (resumeData.jobId) {
    await sendMsg(MSG.SET_JOB_TEMPLATE, { jobId: resumeData.jobId, templateId: chosen });
  }

  const newTpl = templates[chosen];

  if (confirm('是否使用新模板重新评分？')) {
    const s = await cvfxGetSettings();
    await scoreCandidate(s, chosen, null);
  } else {
    cvfx.renderOverlay('idle', { templateName: newTpl?.name });
  }
});

// Popup / Background 消息
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case MSG.START_BATCH:
      cvfx.startBatch(msg.templateId)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case MSG.STOP_BATCH:
      cvfx.stopBatch().then(() => sendResponse({ ok: true }));
      return true;

    case MSG.GET_PAGE_TYPE:
      sendResponse({ pageType: cvfx.detectPageType(), pageReady: cvfx.pageReady });
      break;

    case MSG.GET_CANDIDATE_COUNT: {
      const links = cvfx.collectCandidateLinks?.() ?? [];
      sendResponse({ count: links.length });
      break;
    }

    case MSG.SCORE_CURRENT: {
      cvfxGetSettings().then(settings => {
        scoreCandidate(settings, msg.templateId || null, null);
      });
      sendResponse({ ok: true });
      return true;
    }

    case MSG.TEMPLATE_CHANGED: {
      const tplName = msg.templateName || null;
      cvfx.renderOverlay('idle', { templateName: tplName });
      sendResponse({ ok: true });
      return true;
    }
  }
});

// ── SPA 路由变化 ──────────────────────────────────────────────
let lastPath = location.pathname + location.search;

function handleRouteChange() {
  const cur = location.pathname + location.search;
  if (cur !== lastPath) {
    lastPath = cur;
    currentTalentId = null;
    cvfx.pageReady = false;
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
