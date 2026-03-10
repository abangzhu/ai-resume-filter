/**
 * CVFilterX - DOM 提取器
 * 基于飞书招聘真实 DOM 结构（enterprise 域名 /hire/ 路径）
 *
 * 已验证的页面结构：
 *   候选人详情: /hire/talent/{talentId}?application_id=...&job_id=...
 *   JD 页面:    /hire/job/{jobId}?activeTab=basicInfo
 *   评估列表:   /hire/application-biz/evaluation/list
 */

// ── URL 匹配规则 ──────────────────────────────────────────────
const URL_PATTERNS = {
  talentId:      /\/hire\/talent\/(\d+)/,
  jobId:         /[?&]job_id=(\d+)/,
  applicationId: /[?&]application_id=(\d+)/,
  jobPageId:     /\/hire\/job\/(\d+)/,
};

// ── 选择器（全部基于真实 DOM 验证）────────────────────────────
const SELECTORS = {
  candidate: {
    // 候选人姓名和 ID：ee-name-enhance-card 有 data-talent-id 和 data-name 属性
    talentEl:           '[data-talent-id]',

    // 简历主体：talentDetailTabList 包含解析后的附件简历（工作经历+技能+项目）
    // 约 1500+ 字符，远比摘要卡片详细
    resumeTabContent:   '[class*="talentDetailTabList"]',

    // 基本信息摘要区域（补充：姓名/联系方式）
    basicInfoSummary:   '[class*="basicInfoSummary"]',
    contactInfo:        '[class*="contactInfoContainer"]',

    // 工作经历摘要卡（仅公司/职位/日期，无描述）
    careerContainer:    '[class*="careerListContainer"]',

    // 教育背景摘要卡
    educationContainer: '[class*="educationListContainer"]',

    // 岗位信息（候选人页内的职位卡片）
    jobInfo:            '[class*="jobInfo__"]',
  },

  // JD 页面 (/hire/job/{id}?activeTab=basicInfo)
  jobPage: {
    // 包含职位描述的面板（第一个 item 含职位名称 + 职位描述全文）
    panelItem:    '.job-showcase-panel-item',
    // 职位名称（稳定）
    jobTitle:     '[class*="jobName__"]',
  },

  // 评估列表页 (/hire/application-biz/evaluation/list)
  list: {
    // 候选人详情链接（已验证：href 包含 /hire/talent/）
    candidateLinks: 'a[href*="/hire/talent/"]',
    // 分页按钮
    nextPage: '.atsx__ud__pagination-item-link',
    paginationItem: '.atsx__ud__pagination-item',
    activePageItem: '.atsx__ud__pagination-item-active',
  },
};

// ── 工具函数 ─────────────────────────────────────────────────
function waitForElement(selectors, timeout = 10000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  return new Promise((resolve, reject) => {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el) { resolve(el); return; }
    }
    const observer = new MutationObserver(() => {
      for (const sel of list) {
        const el = document.querySelector(sel);
        if (el) { observer.disconnect(); resolve(el); return; }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`waitForElement timeout: ${list[0]}`));
    }, timeout);
  });
}

// ── 页面类型检测 ──────────────────────────────────────────────
function detectPageType() {
  const path = location.pathname;
  if (URL_PATTERNS.talentId.test(path))  return 'candidate_detail';
  if (URL_PATTERNS.jobPageId.test(path)) return 'job_detail';
  if (path.includes('/evaluation/list')) return 'candidate_list';
  if (path.includes('/hire/'))           return 'hire_other';
  return 'unknown';
}

// ── 候选人简历提取 ────────────────────────────────────────────
function extractResumeData(fieldConfig = {}) {
  const sel = SELECTORS.candidate;

  // 候选人 ID + 姓名（来自 data-talent-id 元素）
  const talentEl = document.querySelector(sel.talentEl);
  const candidateId = talentEl?.getAttribute('data-talent-id')
    || location.pathname.match(URL_PATTERNS.talentId)?.[1]
    || `cand_${Date.now()}`;
  const candidateName = talentEl?.getAttribute('data-name')
    || talentEl?.innerText?.trim()
    || '未知候选人';

  // 从 URL 提取关联信息
  const jobId = new URLSearchParams(location.search).get('job_id') || '';
  const applicationId = new URLSearchParams(location.search).get('application_id') || '';

  const data = {
    candidateId,
    candidateName,
    jobId,
    applicationId,
    extractedAt: Date.now(),
  };

  // ── 主简历内容：talentDetailTabList 包含解析后的附件简历全文
  // 含工作职责描述、技能列表、项目经历，约 1500+ 字符
  const resumeTabEl = document.querySelector(sel.resumeTabContent);
  if (resumeTabEl) {
    const raw = resumeTabEl.innerText.trim();
    // 去掉 Tab 导航噪音行（"Resume files (1)"/"Details"/"Additional Information"/"More"）
    const noiseWords = new Set(['Resume files (1)', 'Details', 'Additional Information', 'More']);
    const lines = raw.split('\n');
    let startIdx = 0;
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      const l = lines[i].trim();
      if (l === '' || noiseWords.has(l) || l.startsWith('Resume files')) startIdx = i + 1;
      else break;
    }
    data.resumeText = lines.slice(startIdx).join('\n').trim();
  }

  // ── 补充字段（当 resumeText 为空时提供 fallback）──

  // 联系方式
  if (fieldConfig.basicInfo !== false) {
    const el = document.querySelector(sel.contactInfo);
    if (el) data.contactText = el.innerText.trim();
  }

  // 工作经历摘要卡（公司/职位/日期，resumeText 已有详情时可省略）
  if (fieldConfig.workExperience !== false) {
    const el = document.querySelector(sel.careerContainer);
    if (el) data.careerSummary = el.innerText.trim();
  }

  // 教育背景摘要卡
  if (fieldConfig.education !== false) {
    const el = document.querySelector(sel.educationContainer);
    if (el) data.educationSummary = el.innerText.trim();
  }

  // 岗位信息（候选人投递的职位基本信息）
  const jobEl = document.querySelector(sel.jobInfo);
  if (jobEl) data.appliedJobInfo = jobEl.innerText.trim();

  return data;
}

// ── JD 提取（在 /hire/job/{id} 页面调用）────────────────────
function extractJobData() {
  const jobIdFromPath = location.pathname.match(URL_PATTERNS.jobPageId)?.[1]
    || new URLSearchParams(location.search).get('job_id')
    || `job_${Date.now()}`;

  // 找第一个包含"职位描述"的 job-showcase-panel-item
  const panels = document.querySelectorAll(SELECTORS.jobPage.panelItem);
  let rawJD = '';
  let jobTitle = '';

  for (const panel of panels) {
    const text = panel.innerText || '';
    if (text.includes('职位描述') || text.includes('职位名称')) {
      rawJD = text.trim();
      // 提取职位名称（格式：职位名称\n高级AI Agent工程师\n...）
      const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
      const titleIdx = lines.indexOf('职位名称');
      if (titleIdx >= 0 && lines[titleIdx + 1]) {
        jobTitle = lines[titleIdx + 1];
      }
      break;
    }
  }

  // 从 URL 标题 fallback
  if (!jobTitle) {
    const titleEl = document.querySelector(SELECTORS.jobPage.jobTitle);
    jobTitle = titleEl?.innerText?.trim() || document.title;
  }

  return {
    jobId: jobIdFromPath,
    jobTitle,
    rawJD: rawJD || `[JD 提取失败，页面可能尚未完全渲染]`,
    capturedAt: Date.now(),
  };
}

// ── 评估列表：收集候选人链接 ─────────────────────────────────
//
// 飞书招聘评估列表（/hire/application-biz/evaluation/list）中
// 候选人行通常不直接渲染 <a href="/hire/talent/…"> 链接，
// 而是通过 ee-name-enhance-card 等组件携带 data-talent-id /
// data-application-id 属性，或使用 React onClick 导航。
// 以下按优先级依次尝试四种策略。
function collectCandidateLinks() {
  // ── 策略 0：优先使用 API 拦截数据（Canvas 渲染页面无 DOM 可查）──
  const evalList = window.__cvfx._evalList;
  if (evalList?.length > 0) {
    const links = evalList.map(item => {
      const params = new URLSearchParams();
      if (item.application_id) params.set('application_id', item.application_id);
      if (item.job_id)          params.set('job_id', item.job_id);
      return `${location.origin}/hire/talent/${item.talent_id}?${params}`;
    });
    console.log(`[CVFilterX] collectCandidateLinks (API): ${links.length} 条`);
    return links;
  }

  const seen = new Set();
  const links = [];

  // 从当前 URL 取 job_id（评估列表可能在 query 里带上）
  const _p = new URLSearchParams(location.search);
  const listJobId = _p.get('job_id') || _p.get('jobId')
    || _p.get('position_id') || _p.get('positionId') || '';

  // ── 策略 1：标准 <a href> 链接（直接跳转 talent 页） ────────
  const linkSelectors = [
    'a[href*="/hire/talent/"]',
    'a[href*="/hire/application-biz/talent/"]',
    'a[href*="/hire/application-biz/evaluation/detail"]',
  ];
  for (const sel of linkSelectors) {
    document.querySelectorAll(sel).forEach(a => {
      const href = a.href;
      if (!href || /^javascript/i.test(href) || href === location.href) return;
      try {
        const url = new URL(href);
        const key = url.pathname + (url.searchParams.get('application_id') || '');
        if (seen.has(key)) return;
        seen.add(key);
        links.push(href);
      } catch {}
    });
    if (links.length > 0) {
      console.log(`[CVFilterX] collectCandidateLinks: ${links.length} 条（${sel}）`);
      return links;
    }
  }

  // ── 策略 2：data-talent-id 属性（ee-name-enhance-card 等组件）
  // 评估列表每行候选人通常渲染携带 data-talent-id 的名片组件
  const talentEls = document.querySelectorAll('[data-talent-id]');
  talentEls.forEach(el => {
    const talentId = el.getAttribute('data-talent-id');
    if (!talentId || seen.has(talentId)) return;
    seen.add(talentId);

    // 尝试从同行/父级取 application_id
    const rowEl = el.closest('[data-application-id], [data-app-id], tr, [class*="tableRow"], [class*="list-item"]');
    const appId = rowEl?.getAttribute('data-application-id')
      || rowEl?.getAttribute('data-app-id') || '';

    const params = new URLSearchParams();
    if (appId)      params.set('application_id', appId);
    if (listJobId)  params.set('job_id', listJobId);
    links.push(`${location.origin}/hire/talent/${talentId}?${params}`);
  });
  if (links.length > 0) {
    console.log(`[CVFilterX] collectCandidateLinks: ${links.length} 条（data-talent-id）`);
    return links;
  }

  // ── 策略 3：表格/列表容器内任意含 /hire/ 的链接 ───────────
  Array.from(document.querySelectorAll(
    'table a[href], [class*="table"] a[href], [class*="Table"] a[href], [class*="list"] a[href]'
  )).filter(a => {
    const h = a.getAttribute('href') || '';
    return h.includes('/hire/') && !h.includes('/evaluation/list');
  }).forEach(a => {
    if (seen.has(a.href)) return;
    seen.add(a.href);
    links.push(a.href);
  });
  if (links.length > 0) {
    console.log(`[CVFilterX] collectCandidateLinks: ${links.length} 条（table anchor fallback）`);
    return links;
  }

  // ── 诊断日志（方便排查实际 DOM 结构）─────────────────────
  console.warn(
    '[CVFilterX] 未找到候选人链接。',
    'data-talent-id 元素数:', document.querySelectorAll('[data-talent-id]').length,
    '；含 /hire/ 的 a[href] 前8条:',
    Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.getAttribute('href'))
      .filter(h => h && h.includes('/hire/'))
      .slice(0, 8)
  );
  return links;
}

// ── 评估列表：从过滤标签/URL 提取当前职位信息 ─────────────────
function extractJobFromEvalList() {
  // 1. 从 URL 参数取 jobId
  const params = new URLSearchParams(location.search);
  const jobId = params.get('job_id') || params.get('jobId')
    || params.get('positionId') || params.get('position_id') || '';

  // 2. 从过滤 Tag 提取职位名称
  //    飞书过滤器通常渲染为 class 含 tag / filter 的标签元素
  let jobTitle = '';
  const tagSelectors = [
    '[class*="filterTag"] [class*="name"]',
    '[class*="filter-tag"] [class*="label"]',
    '[class*="TagItem"] [class*="text"]',
    '[class*="filterItem"] [class*="value"]',
    '[class*="tag-item"]',
  ];
  for (const sel of tagSelectors) {
    for (const el of document.querySelectorAll(sel)) {
      const text = el.innerText?.trim().replace(/\s*[×x✕]\s*$/, '').trim();
      // 排除"投递职位"这类 label 文字，保留职位名（通常 3-30 字）
      if (text && text.length >= 2 && text.length <= 30
          && !text.includes('投递') && !text.includes('状态')) {
        jobTitle = text;
        break;
      }
    }
    if (jobTitle) break;
  }

  if (!jobId && !jobTitle) return null;

  return {
    jobId:      jobId || `eval_${Date.now()}`,
    jobTitle:   jobTitle || (jobId ? `职位 ${jobId}` : ''),
    rawJD:      '',     // 仅摘要，无完整 JD 文本
    capturedAt: Date.now(),
    partial:    true,   // 标记为不完整，getJobData() 会跳过空 rawJD
  };
}

// ── 评估列表 API 数据缓存 ─────────────────────────────────────
// 由 api-interceptor.js（页面上下文）通过 CustomEvent 传入
window.__cvfx = window.__cvfx || {};
window.__cvfx._evalList = null;

document.addEventListener('cvfx:eval-list', (e) => {
  const items = e.detail?.data?.evaluation_list;
  if (Array.isArray(items) && items.length > 0) {
    window.__cvfx._evalList = items;
    console.log(`[CVFilterX] 评估列表 API 数据已捕获: ${items.length} 条`);
  }
});

// 直接调用评估列表 API（garfish 沙盒导致 fetch 拦截器失效时的 fallback）
async function fetchEvalListDirect() {
  const params = new URLSearchParams(location.search);
  const activityStatus = parseInt(params.get('activeStatus') ?? '1', 10);
  const filters = decodeURIComponent(params.get('newFilters') ?? '{}');

  try {
    const res = await fetch(`${location.origin}/atsx/api/evaluation/list_v2/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        q: '',
        filters,
        activity_status: activityStatus,
        offset: 0,
        limit: 200,
      }),
    });
    const json = await res.json();
    const items = json?.data?.evaluation_list;
    if (Array.isArray(items) && items.length > 0) {
      window.__cvfx._evalList = items;
      console.log(`[CVFilterX] 评估列表直接调用成功: ${items.length} 条`);
      return items;
    }
  } catch (e) {
    console.warn('[CVFilterX] fetchEvalListDirect 失败:', e.message);
  }
  return null;
}

// 等待评估列表 API 数据就绪
// 优先等待拦截器事件（1.5s），超时后直接调用 API
function waitForEvalList(timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (window.__cvfx._evalList?.length > 0) {
      resolve(window.__cvfx._evalList);
      return;
    }

    let settled = false;
    const settle = (items) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('cvfx:eval-list', handler);
      clearTimeout(interceptorTimer);
      clearTimeout(totalTimer);
      if (items?.length > 0) resolve(items);
      else reject(new Error('waitForEvalList: no data'));
    };

    const handler = (e) => {
      const items = e.detail?.data?.evaluation_list;
      if (items?.length > 0) {
        window.__cvfx._evalList = items;
        settle(items);
      }
    };
    document.addEventListener('cvfx:eval-list', handler);

    // 1.5s 内没有拦截到事件则直接调用 API（garfish 沙盒场景）
    const interceptorTimer = setTimeout(() => {
      if (settled) return;
      fetchEvalListDirect().then(items => settle(items));
    }, 1500);

    const totalTimer = setTimeout(() => settle(null), timeout);
  });
}

// ── 导出 ─────────────────────────────────────────────────────
Object.assign(window.__cvfx, {
  detectPageType,
  extractResumeData,
  extractJobData,
  collectCandidateLinks,
  extractJobFromEvalList,
  waitForElement,
  waitForEvalList,
  fetchEvalListDirect,
  URL_PATTERNS,
  SELECTORS,
});
