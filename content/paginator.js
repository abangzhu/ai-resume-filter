/**
 * CVFilterX - Phase 2 自动翻页控制器
 *
 * 流程：
 *   1. 用户在评估列表页点击「开始筛选」
 *   2. 收集当前页所有候选人链接 → 写入 taskState.queue
 *   3. 依次导航到每条候选人详情页
 *   4. 每页评分完成后，等待 autoPaginateDelay ms，自动跳下一条
 *   5. 当前列表页处理完后，检测是否有下一页并继续
 */

const TASK_KEY = 'taskState';

// ── 读写任务状态 ──────────────────────────────────────────────
async function getTaskState() {
  const d = await chrome.storage.local.get(TASK_KEY);
  return d[TASK_KEY] || null;
}

async function setTaskState(state) {
  await chrome.storage.local.set({ [TASK_KEY]: state });
  // 通知 Popup 刷新进度（忽略 popup 未打开的错误）
  chrome.runtime.sendMessage({ type: 'TASK_PROGRESS', state }).catch(() => {});
}

// ── 启动批量处理（在列表页调用）──────────────────────────────
async function startBatch(templateId) {
  const links = window.__cvfx.collectCandidateLinks();
  if (links.length === 0) {
    throw new Error('当前页面未找到候选人链接，请确认在「评估列表」页');
  }

  const state = {
    isRunning: true,
    queue: links,
    current: 0,
    total: links.length,
    pass: 0,
    hold: 0,
    reject: 0,
    errors: [],
    listPageUrl: location.href,   // 记录列表页，处理完后可回来翻页
    templateId: templateId || null,
  };

  await setTaskState(state);
  console.log(`[CVFilterX] 批量开始，共 ${links.length} 位候选人`);

  // 导航到第一位候选人
  await _navigateTo(links[0]);
}

// ── 停止批量处理 ──────────────────────────────────────────────
async function stopBatch() {
  const state = await getTaskState();
  if (state) {
    state.isRunning = false;
    await setTaskState(state);
  }
  console.log('[CVFilterX] 批量已停止');
}

// ── 评分完成后的回调（在候选人详情页调用）────────────────────
async function onScoreComplete(result) {
  const state = await getTaskState();
  if (!state?.isRunning) return;

  // 更新统计
  const rec = result?.recommendation;
  if (rec && rec in state) state[rec]++;

  state.current++;
  await setTaskState(state);

  if (state.current >= state.total) {
    await _onBatchDone(state);
    return;
  }

  const settings = await _getSettings();
  const delay = settings.autoPaginateDelay ?? 2000;

  console.log(`[CVFilterX] ${state.current}/${state.total} 完成，${delay}ms 后进入下一位`);
  setTimeout(() => _navigateTo(state.queue[state.current]), delay);
}

// ── 评分失败后的回调 ──────────────────────────────────────────
async function onScoreError(errMsg) {
  const state = await getTaskState();
  if (!state?.isRunning) return;

  state.errors.push(`#${state.current + 1}: ${errMsg}`);
  state.current++;
  await setTaskState(state);

  if (state.current >= state.total) {
    await _onBatchDone(state);
    return;
  }

  const settings = await _getSettings();
  const delay = settings.autoPaginateDelay ?? 2000;
  setTimeout(() => _navigateTo(state.queue[state.current]), delay);
}

// ── 判断当前候选人页是否属于批量任务 ─────────────────────────
async function isBatchRunning() {
  const state = await getTaskState();
  return !!(state?.isRunning);
}

// ── 内部函数 ──────────────────────────────────────────────────
async function _onBatchDone(state) {
  state.isRunning = false;
  await setTaskState(state);
  console.log('[CVFilterX] 批量完成', {
    total: state.total,
    pass: state.pass,
    hold: state.hold,
    reject: state.reject,
    errors: state.errors.length,
  });
}

async function _navigateTo(url) {
  // 确保 url 有效
  if (!url) return;
  window.location.href = url;
}

async function _getSettings() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    return res?.settings || {};
  } catch {
    return {};
  }
}

// ── 导出 ─────────────────────────────────────────────────────
window.__cvfx = window.__cvfx || {};
Object.assign(window.__cvfx, {
  startBatch,
  stopBatch,
  onScoreComplete,
  onScoreError,
  isBatchRunning,
  getTaskState,
});
