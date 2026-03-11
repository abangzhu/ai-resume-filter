/**
 * CVFilterX - Popup
 */

const $ = id => document.getElementById(id);

let currentJobId = null;
let selectedTemplateId = null;

// ── 初始化 ────────────────────────────────────────────────────
async function init() {
  const settings = await getSettings();

  if (!settings.apiKey) {
    $('api-warning').style.display = 'block';
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isHirePage = tab?.url?.includes('.feishu.cn/hire/');

  if (isHirePage) {
    await loadPageInfo(tab);
  } else {
    $('job-title').textContent = '请切换到飞书招聘';
    $('jd-status').className = 'info-value status-miss';
    $('candidate-count').textContent = '--';
    $('btn-start').disabled = true;
  }

  await loadStats();
  await syncBatchState();
}

// ── 读取页面信息 ──────────────────────────────────────────────
async function loadPageInfo(tab) {
  let pageType = 'unknown';
  let candidateCount = 0;

  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_TYPE' });
    pageType = res?.pageType || 'unknown';
  } catch { /* content script 未就绪 */ }

  if (pageType === 'candidate_list') {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CANDIDATE_COUNT' });
      candidateCount = res?.count || 0;
    } catch {}
    $('candidate-count').textContent = `${candidateCount} 人`;
    $('btn-start').disabled = candidateCount === 0;
  } else {
    // 非列表页（候选人详情 / hire_other / unknown）：显示单候选人评分按钮
    $('candidate-count').textContent = '详情页';
    $('btn-start').style.display = 'none';
    $('btn-score-current').style.display = '';
  }

  // 最近的 JD
  const data = await chrome.storage.local.get('jobs');
  const jobs = Object.values(data.jobs ?? {}).sort((a, b) => b.capturedAt - a.capturedAt);
  if (jobs[0]) {
    $('job-title').textContent = jobs[0].jobTitle || '--';
    $('jd-status').textContent = 'OK 已缓存';
    $('jd-status').className = 'info-value status-ok';
    currentJobId = jobs[0].jobId;
  } else {
    $('job-title').textContent = '--';
    $('jd-status').textContent = '未抓取（访问职位页自动获取）';
    $('jd-status').className = 'info-value status-miss';
  }

  // 模板加载
  await loadTemplateSelection(pageType, candidateCount);
}

// ── 模板选择 ──────────────────────────────────────────────────
async function loadTemplateSelection(pageType, candidateCount) {
  let tplRes;
  try { tplRes = await sendMsg(MSG.GET_TEMPLATES); }
  catch { return; }

  const templates = tplRes.templates;
  const tplList = Object.values(templates);
  if (tplList.length === 0) return;

  // 查询当前 job 已绑定的模板
  let jobTemplate = null;
  if (currentJobId) {
    try {
      const jtRes = await sendMsg(MSG.GET_JOB_TEMPLATE, { jobId: currentJobId });
      if (jtRes?.jobTemplate) jobTemplate = jtRes.jobTemplate;
    } catch { /* ignore */ }
  }

  // 如果已有关联模板，显示名称
  if (jobTemplate && templates[jobTemplate.templateId]) {
    selectedTemplateId = jobTemplate.templateId;
    $('template-name').textContent = templates[jobTemplate.templateId].name;
  } else {
    // 尝试自动匹配
    const jobTitle = $('job-title').textContent;
    if (jobTitle && jobTitle !== '--') {
      const matchRes = await sendMsg(MSG.MATCH_TEMPLATE, { jobTitle });
      if (matchRes?.template) {
        selectedTemplateId = matchRes.template.id;
        $('template-name').textContent = `${matchRes.template.name}（推荐）`;
      } else {
        // 使用默认模板
        const defaultTpl = tplList.find(t => t.isDefault) || tplList[0];
        selectedTemplateId = defaultTpl.id;
        $('template-name').textContent = defaultTpl.name;
      }
    } else {
      const defaultTpl = tplList.find(t => t.isDefault) || tplList[0];
      selectedTemplateId = defaultTpl.id;
      $('template-name').textContent = defaultTpl.name;
    }
  }

  // 列表页有候选人 或 候选人详情页 均显示下拉选择
  if ((pageType === 'candidate_list' && candidateCount > 0) || pageType === 'candidate_detail') {
    $('template-select-area').style.display = '';
    const select = $('template-select');
    select.innerHTML = tplList.map(t => {
      const selected = t.id === selectedTemplateId ? ' selected' : '';
      const label = t.isDefault ? `${escHtml(t.name)}（默认）` : escHtml(t.name);
      return `<option value="${escHtml(t.id)}"${selected}>${label}</option>`;
    }).join('');

    select.addEventListener('change', async () => {
      selectedTemplateId = select.value;
      const tpl = templates[selectedTemplateId];
      $('template-name').textContent = tpl?.name || '--';
      if (currentJobId) {
        await sendMsg(MSG.SET_JOB_TEMPLATE, { jobId: currentJobId, templateId: selectedTemplateId });
      }
      // 候选人详情页：通知 content script 同步 overlay
      if (pageType === 'candidate_detail') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'TEMPLATE_CHANGED',
            templateId: selectedTemplateId,
            templateName: tpl?.name,
          }).catch(() => {});
        }
      }
    });
  }
}

// ── 同步批量任务状态 ──────────────────────────────────────────
async function syncBatchState() {
  const data = await chrome.storage.local.get('taskState');
  const state = data.taskState;

  if (state?.isRunning) {
    showProgress(state);
    $('btn-start').style.display = 'none';
    $('btn-stop').style.display  = '';
  } else {
    $('progress-area').style.display = 'none';
    // 仅在单候选人评分按钮未显示时恢复批量按钮，避免覆盖详情页状态
    if ($('btn-score-current').style.display === 'none') {
      $('btn-start').style.display = '';
    }
    $('btn-stop').style.display  = 'none';
  }
}

function showProgress(state) {
  $('progress-area').style.display = 'block';
  const pct = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
  $('progress-bar').style.width   = `${pct}%`;
  $('progress-cur').textContent   = state.current;
  $('progress-total').textContent = state.total;

  if (state.errors?.length > 0) {
    $('progress-errors').style.display = 'block';
    $('progress-errors').textContent = `${state.errors.length} 个错误`;
  }
}

// ── 加载评分统计 ──────────────────────────────────────────────
async function loadStats() {
  const data = await chrome.storage.local.get('scores');
  const scores = Object.values(data.scores ?? {});
  const counts = { pass: 0, hold: 0, reject: 0 };
  scores.forEach(s => { if (s.recommendation in counts) counts[s.recommendation]++; });
  $('stat-pass').textContent   = counts.pass;
  $('stat-hold').textContent   = counts.hold;
  $('stat-reject').textContent = counts.reject;
}

async function getSettings() {
  const res = await sendMsg(MSG.GET_SETTINGS);
  return res?.settings ?? {};
}

// ── 监听后台进度推送 ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MSG.TASK_PROGRESS) {
    showProgress(msg.state);
    if (!msg.state.isRunning) {
      $('btn-start').style.display = '';
      $('btn-stop').style.display  = 'none';
    }
    loadStats();
  }
  if (msg.type === MSG.SCORE_RESULT) {
    loadStats();
    // 评分完成后重新启用单候选人评分按钮
    const btnScore = $('btn-score-current');
    if (btnScore) btnScore.disabled = false;
  }
});

// ── 事件绑定 ──────────────────────────────────────────────────
$('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('link-settings')?.addEventListener('click', e => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

$('btn-start').addEventListener('click', async () => {
  // 确保已选择模板
  if (!selectedTemplateId) {
    showToast('请先选择评分模板', 'warning');
    return;
  }

  // 保存关联
  if (currentJobId) {
    await sendMsg(MSG.SET_JOB_TEMPLATE, { jobId: currentJobId, templateId: selectedTemplateId });
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  $('btn-start').disabled = true;
  try {
    const res = await sendTabMsg(tab.id, MSG.START_BATCH, { templateId: selectedTemplateId });
    if (!res?.ok) {
      showToast(res?.error || '启动失败，请确认在评估列表页', 'error');
      $('btn-start').disabled = false;
      return;
    }
    $('btn-start').style.display = 'none';
    $('btn-stop').style.display  = '';
    $('progress-area').style.display = 'block';
  } catch (e) {
    showToast('无法连接到页面，请刷新后重试', 'error');
    $('btn-start').disabled = false;
  }
});

$('btn-score-current').addEventListener('click', async () => {
  if (!selectedTemplateId) {
    showToast('请先选择评分模板', 'warning');
    return;
  }

  // 保存 jobTemplate 绑定
  if (currentJobId) {
    await sendMsg(MSG.SET_JOB_TEMPLATE, { jobId: currentJobId, templateId: selectedTemplateId });
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  $('btn-score-current').disabled = true;
  try {
    const res = await sendTabMsg(tab.id, MSG.SCORE_CURRENT, { templateId: selectedTemplateId });
    if (!res?.ok) {
      showToast(res?.error || '评分启动失败', 'error');
      $('btn-score-current').disabled = false;
    }
    // 评分进行中，按钮保持禁用；SCORE_RESULT 消息到达后刷新统计
  } catch {
    showToast('无法连接到页面，请刷新后重试', 'error');
    $('btn-score-current').disabled = false;
  }
});

$('btn-stop').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    await sendTabMsg(tab.id, MSG.STOP_BATCH).catch(() => {});
  }
  const d = await chrome.storage.local.get('taskState');
  if (d.taskState) {
    await chrome.storage.local.set({ taskState: { ...d.taskState, isRunning: false } });
  }
  $('btn-stop').style.display  = 'none';
  $('btn-start').style.display = '';
  $('btn-start').disabled = false;
  $('progress-area').style.display = 'none';
});

$('btn-clear').addEventListener('click', async () => {
  if (!confirm('确认清除所有评分记录？')) return;
  await chrome.storage.local.remove(['scores', 'taskState']);
  await loadStats();
  await syncBatchState();
});

$('btn-export').addEventListener('click', async () => {
  const data = await chrome.storage.local.get('scores');
  const scores = Object.values(data.scores ?? {});
  if (scores.length === 0) { showToast('暂无评分记录', 'info'); return; }

  const rows = [['候选人ID','岗位ID','评分时间','推荐建议','综合分','使用模板','亮点','关注点','点评']];
  scores.forEach(s => rows.push([
    s.candidateId, s.jobId,
    new Date(s.scoredAt).toLocaleString('zh-CN'),
    { pass: '通过', hold: '待定', reject: '淘汰' }[s.recommendation] ?? s.recommendation,
    s.overallScore,
    s.templateName ?? '默认',
    (s.highlights ?? []).join('; '),
    (s.concerns ?? []).join('; '),
    s.summary ?? '',
  ]));

  const csv = rows.map(r =>
    r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `cvfilterx_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── 启动 ──────────────────────────────────────────────────────
init();
