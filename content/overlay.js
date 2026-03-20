/**
 * CVFilterX - 评分浮层组件
 * 注入到飞书招聘候选人详情页，展示评分状态和结果
 * Uses event delegation — events are bound once at mount, not on each render.
 */

const OVERLAY_ID = 'cvfx-overlay';

const BADGE_MAP = {
  pass:   { icon: 'OK', text: '通过' },
  hold:   { icon: '--',  text: '待定' },
  reject: { icon: 'NO', text: '淘汰' },
};

// ── 状态 ────────────────────────────────────────────────────
let overlayState = 'idle';
let overlayPayload = {};
let overlayCollapsed = false;
let loadingTimerId = null;
let loadingStartTime = 0;

// ── 挂载 / 卸载 ──────────────────────────────────────────────
async function mountOverlay() {
  if (document.getElementById(OVERLAY_ID)) return;

  const el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.innerHTML = buildHTML('idle');

  // 读取保存的位置
  let pos = { top: 16, right: 16 };
  try {
    const data = await chrome.storage.local.get('overlayPosition');
    if (data.overlayPosition) pos = data.overlayPosition;
  } catch { /* use default */ }

  el.style.top = `${pos.top}px`;
  el.style.right = `${pos.right}px`;

  document.body.appendChild(el);
  initOverlayEvents(el);
}

function unmountOverlay() {
  stopLoadingTimer();
  const el = document.getElementById(OVERLAY_ID);
  if (el?.__cvfxCleanup) el.__cvfxCleanup();
  el?.remove();
}

// ── 事件委托（只在 mount 时绑定一次）─────────────────────────
function initOverlayEvents(el) {
  // ── 拖拽逻辑 ────────────────────────────────────────────────
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartTop = 0;
  let dragStartRight = 0;
  let hasMoved = false;

  const onMouseDown = (e) => {
    if (!e.target.closest('#cvfx-header')) return;
    dragging = true;
    hasMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartTop = parseInt(el.style.top) || 16;
    dragStartRight = parseInt(el.style.right) || 16;
    el.querySelector('#cvfx-header')?.classList.add('cvfx-dragging');
    e.preventDefault();
  };

  const onMouseMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;

    let newTop = dragStartTop + dy;
    let newRight = dragStartRight - dx;

    // 边界检测
    const maxTop = window.innerHeight - 60;
    const maxRight = window.innerWidth - 60;
    newTop = Math.max(0, Math.min(newTop, maxTop));
    newRight = Math.max(0, Math.min(newRight, maxRight));

    el.style.top = `${newTop}px`;
    el.style.right = `${newRight}px`;
  };

  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    el.querySelector('#cvfx-header')?.classList.remove('cvfx-dragging');

    if (hasMoved) {
      const pos = {
        top: parseInt(el.style.top) || 16,
        right: parseInt(el.style.right) || 16,
      };
      chrome.storage.local.set({ overlayPosition: pos }).catch(() => {});
    }
  };

  el.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // cleanup 函数，在 unmount 时调用
  el.__cvfxCleanup = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  // ── 点击事件委托 ──────────────────────────────────────────────
  el.addEventListener('click', (e) => {
    // 拖拽后不触发点击
    if (hasMoved) { hasMoved = false; return; }

    const target = e.target.closest('[data-action]');

    // 点击标题栏切换折叠/展开
    if (!target && e.target.closest('#cvfx-header')) {
      overlayCollapsed = !overlayCollapsed;
      el.classList.toggle('collapsed', overlayCollapsed);
      el.innerHTML = buildHTML(overlayState, overlayPayload);
      return;
    }

    if (!target) return;

    const action = target.dataset.action;
    e.stopPropagation();

    switch (action) {
      case 'collapse':
        overlayCollapsed = true;
        el.classList.add('collapsed');
        el.innerHTML = buildHTML(overlayState, overlayPayload);
        break;

      case 'score':
        document.dispatchEvent(new CustomEvent('cvfx:score-request'));
        break;

      case 'switch-tpl':
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('cvfx:switch-template'));
        break;

      case 'toggle-dim': {
        const row = target.closest('.cvfx-dim-row');
        if (row) row.classList.toggle('expanded');
        break;
      }
    }
  });
}

// ── 渲染 ─────────────────────────────────────────────────────
function renderOverlay(state, payload = {}) {
  const el = document.getElementById(OVERLAY_ID);
  if (!el) return;

  overlayState = state;
  overlayPayload = payload;
  el.className = overlayCollapsed ? 'collapsed' : '';

  // 计时器管理
  if (state === 'loading') {
    startLoadingTimer(el);
  } else {
    stopLoadingTimer();
  }

  el.innerHTML = buildHTML(state, payload);
}

function startLoadingTimer(el) {
  stopLoadingTimer();
  loadingStartTime = Date.now();
  loadingTimerId = setInterval(() => {
    const elapsed = Math.floor((Date.now() - loadingStartTime) / 1000);
    const timerEl = el.querySelector('.cvfx-timer');
    if (timerEl) {
      timerEl.textContent = `已用时 ${elapsed}s`;
    }
    const slowEl = el.querySelector('.cvfx-timer-slow');
    if (slowEl) {
      slowEl.style.display = elapsed >= 15 ? '' : 'none';
    }
  }, 1000);
}

function stopLoadingTimer() {
  if (loadingTimerId) {
    clearInterval(loadingTimerId);
    loadingTimerId = null;
  }
}

function buildHTML(state, payload = {}) {
  return `
    ${buildHeader(state)}
    <div id="cvfx-body">
      ${buildBody(state, payload)}
    </div>
    ${buildFooter(state, payload)}
  `;
}

function buildHeader(state) {
  const statusMap = {
    idle:    { dot: 'idle',    text: '待评分' },
    loading: { dot: 'loading', text: '评分中...' },
    scored:  { dot: 'scored',  text: '已评分' },
    error:   { dot: 'error',   text: '失败' },
  };
  const s = statusMap[state] ?? statusMap.idle;

  return `
    <div id="cvfx-header">
      <span class="cvfx-title">CVFilterX</span>
      <span class="cvfx-status">
        <span class="cvfx-dot ${s.dot}"></span>
        ${s.text}
      </span>
    </div>
  `;
}

function buildBody(state, payload) {
  if (overlayCollapsed) return '';

  switch (state) {
    case 'idle': {
      const tplHtml = payload.templateName
        ? `<div class="cvfx-template-info">当前模板：${escHtml(payload.templateName)} <a class="cvfx-tpl-switch" data-action="switch-tpl">切换</a></div>`
        : '';
      return `${tplHtml}<div class="cvfx-hint">点击「开始评分」对当前候选人评分</div>`;
    }

    case 'loading':
      return `<div class="cvfx-hint">正在调用 LLM 评估中，请稍候...</div>
              <div class="cvfx-timer">已用时 0s</div>
              <div class="cvfx-timer-slow" style="display:none">模型响应较慢，请耐心等待</div>`;

    case 'error': {
      const errTplHtml = payload.templateName
        ? `<div class="cvfx-template-info">当前模板：${escHtml(payload.templateName)} <a class="cvfx-tpl-switch" data-action="switch-tpl">切换</a></div>`
        : '';
      return `${errTplHtml}<div class="cvfx-error">${escHtml(payload.error ?? '未知错误')}</div>`;
    }

    case 'scored':
      return buildScoredBody(payload.result);

    default:
      return '';
  }
}

function buildSourceLabel(source) {
  if (!source) return '';
  const parts = [];
  if (source.hasText) parts.push(`DOM 文本 (${source.textLength} 字)`);
  if (source.hasImage) parts.push('截图');
  if (parts.length === 0) return '';
  return `<div class="cvfx-source-info">来源：${escHtml(parts.join(' + '))}</div>`;
}

function buildScoredBody(result) {
  if (!result) return '<div class="cvfx-hint">评分数据缺失</div>';

  const badge = BADGE_MAP[result.recommendation] ?? BADGE_MAP.hold;

  const templateHtml = result.templateName
    ? `<div class="cvfx-template-info">使用模板：${escHtml(result.templateName)} <a class="cvfx-tpl-switch" data-action="switch-tpl">切换</a></div>`
    : '';

  const sourceHtml = buildSourceLabel(result.resumeSource);

  const dimensionKeys = Object.keys(result.dimensions ?? {});
  const dimsHtml = dimensionKeys.map(key => {
    const d = result.dimensions[key];
    if (!d || typeof d.score !== 'number') return '';
    const pct = Math.round((d.score / 10) * 100);
    const label = d.label || key;
    const hasComment = d.comment && d.comment.trim();
    return `
      <div class="cvfx-dim-row" data-action="${hasComment ? 'toggle-dim' : ''}">
        <span class="cvfx-dim-label">${escHtml(label)}</span>
        <div class="cvfx-dim-bar-wrap">
          <div class="cvfx-dim-bar" style="width:${pct}%"></div>
        </div>
        <span class="cvfx-dim-score">${d.score}/10</span>
        ${hasComment ? '<span class="cvfx-dim-chevron">&#9654;</span>' : ''}
        ${hasComment ? `<div class="cvfx-dim-comment">${escHtml(d.comment)}</div>` : ''}
      </div>
    `;
  }).join('');

  const highlightsHtml = (result.highlights ?? []).length
    ? `<div class="cvfx-section-title">亮点</div>
       <ul class="cvfx-list">${result.highlights.map(h => `<li>${escHtml(h)}</li>`).join('')}</ul>`
    : '';

  const concernsHtml = (result.concerns ?? []).length
    ? `<div class="cvfx-section-title">关注点</div>
       <ul class="cvfx-list">${result.concerns.map(c => `<li>${escHtml(c)}</li>`).join('')}</ul>`
    : '';

  const summaryHtml = result.summary
    ? `<div class="cvfx-section-title">综合点评</div>
       <div class="cvfx-summary">${escHtml(result.summary)}</div>`
    : '';

  return `
    ${templateHtml}
    ${sourceHtml}
    <div class="cvfx-score-row">
      <span class="cvfx-score-label">综合评分</span>
      <span style="display:flex;align-items:baseline;gap:2px">
        <span class="cvfx-score-value">${result.overallScore}</span>
        <span class="cvfx-score-total">/ 100</span>
      </span>
    </div>
    <div class="cvfx-score-row">
      <span class="cvfx-score-label">推荐建议</span>
      <span class="cvfx-badge ${result.recommendation}">${badge.icon} ${badge.text}</span>
    </div>
    ${result.rankInfo ? `<div class="cvfx-rank-info">${escHtml(result.rankInfo)}</div>` : ''}

    ${dimsHtml ? `<div class="cvfx-divider"></div>${dimsHtml}` : ''}
    ${highlightsHtml ? `<div class="cvfx-divider"></div>${highlightsHtml}` : ''}
    ${concernsHtml  ? `<div class="cvfx-divider"></div>${concernsHtml}`  : ''}
    ${summaryHtml   ? `<div class="cvfx-divider"></div>${summaryHtml}`   : ''}
  `;
}

function buildFooter(state, payload = {}) {
  if (overlayCollapsed) return '';

  const notReady = state === 'idle' && !window.__cvfx.pageReady;
  const btnText = notReady ? '页面加载中...' : (state === 'scored' || state === 'error' ? '重新评分' : '开始评分');
  const disabled = notReady ? ' disabled' : '';
  const rescore = `<button class="cvfx-btn primary" data-action="score"${disabled}>${btnText}</button>`;

  const toggle = `<button class="cvfx-btn" data-action="collapse">收起</button>`;

  return `<div id="cvfx-footer">${toggle}${state !== 'loading' ? rescore : ''}</div>`;
}

function getOverlayState() {
  return overlayState;
}

// ── 导出 ─────────────────────────────────────────────────────
window.__cvfx = window.__cvfx || {};
Object.assign(window.__cvfx, {
  mountOverlay,
  unmountOverlay,
  renderOverlay,
  getOverlayState,
});
