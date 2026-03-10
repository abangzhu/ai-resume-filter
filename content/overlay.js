/**
 * CVFilterX - 评分浮层组件
 * 注入到飞书招聘候选人详情页，展示评分状态和结果
 */

const OVERLAY_ID = 'cvfx-overlay';

const BADGE_MAP = {
  pass:   { icon: 'OK', text: '通过' },
  hold:   { icon: '--',  text: '待定' },
  reject: { icon: 'NO', text: '淘汰' },
};

// ── 状态机 ───────────────────────────────────────────────────
// 'idle' | 'loading' | 'scored' | 'error'
let overlayState = 'idle';
let overlayPayload = {};
let overlayCollapsed = false;

// ── 挂载 / 卸载 ──────────────────────────────────────────────
function mountOverlay() {
  if (document.getElementById(OVERLAY_ID)) return;

  const el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.innerHTML = buildHTML('idle');
  document.body.appendChild(el);

  bindEvents(el);
}

function unmountOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}

// ── 渲染 ─────────────────────────────────────────────────────
function renderOverlay(state, payload = {}) {
  const el = document.getElementById(OVERLAY_ID);
  if (!el) return;

  overlayState = state;
  overlayPayload = payload;
  el.className = overlayCollapsed ? 'collapsed' : '';

  el.innerHTML = buildHTML(state, payload);
  bindEvents(el);
}

function buildHTML(state, payload = {}) {
  return `
    ${buildHeader(state)}
    <div id="cvfx-body">
      ${buildBody(state, payload)}
    </div>
    ${buildFooter(state)}
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
    case 'idle':
      return `<div class="cvfx-hint">点击「开始评分」对当前候选人评分</div>`;

    case 'loading':
      return `<div class="cvfx-hint">正在调用 LLM 评估中，请稍候...</div>`;

    case 'error':
      return `
        <div class="cvfx-error">${escHtml(payload.error ?? '未知错误')}</div>
      `;

    case 'scored':
      return buildScoredBody(payload.result);

    default:
      return '';
  }
}

function buildScoredBody(result) {
  if (!result) return '<div class="cvfx-hint">评分数据缺失</div>';

  const badge = BADGE_MAP[result.recommendation] ?? BADGE_MAP.hold;

  // 模板名称
  const templateHtml = result.templateName
    ? `<div class="cvfx-template-info">使用模板：${escHtml(result.templateName)}</div>`
    : '';

  // 动态渲染维度：从 result.dimensions 中遍历所有 key
  const dimensionKeys = Object.keys(result.dimensions ?? {});
  const dimsHtml = dimensionKeys.map(key => {
    const d = result.dimensions[key];
    if (!d || typeof d.score !== 'number') return '';
    const pct = Math.round((d.score / 10) * 100);
    // 尝试从 key 生成可读 label，fallback 到 key 本身
    const label = d.label || key;
    return `
      <div class="cvfx-dim-row" title="${escHtml(d.comment ?? '')}">
        <span class="cvfx-dim-label">${escHtml(label)}</span>
        <div class="cvfx-dim-bar-wrap">
          <div class="cvfx-dim-bar" style="width:${pct}%"></div>
        </div>
        <span class="cvfx-dim-score">${d.score}/10</span>
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

    ${dimsHtml ? `<div class="cvfx-divider"></div>${dimsHtml}` : ''}
    ${highlightsHtml ? `<div class="cvfx-divider"></div>${highlightsHtml}` : ''}
    ${concernsHtml  ? `<div class="cvfx-divider"></div>${concernsHtml}`  : ''}
    ${summaryHtml   ? `<div class="cvfx-divider"></div>${summaryHtml}`   : ''}
  `;
}

function buildFooter(state) {
  if (overlayCollapsed) return '';

  const rescore = state === 'scored' || state === 'error'
    ? `<button class="cvfx-btn primary" id="cvfx-btn-score">重新评分</button>`
    : `<button class="cvfx-btn primary" id="cvfx-btn-score">开始评分</button>`;

  const toggle = `<button class="cvfx-btn" id="cvfx-btn-collapse">收起</button>`;

  return `<div id="cvfx-footer">${toggle}${state !== 'loading' ? rescore : ''}</div>`;
}

// ── 事件绑定 ─────────────────────────────────────────────────
function bindEvents(el) {
  el.querySelector('#cvfx-btn-collapse')?.addEventListener('click', e => {
    e.stopPropagation();
    overlayCollapsed = true;
    el.classList.add('collapsed');
    el.innerHTML = buildHTML(overlayState, overlayPayload);
    bindEvents(el);
  });

  el.querySelector('#cvfx-header')?.addEventListener('click', () => {
    if (overlayCollapsed) {
      overlayCollapsed = false;
      el.classList.remove('collapsed');
      el.innerHTML = buildHTML(overlayState, overlayPayload);
      bindEvents(el);
    }
  });

  el.querySelector('#cvfx-btn-score')?.addEventListener('click', e => {
    e.stopPropagation();
    // 触发评分，由 content.js 监听
    document.dispatchEvent(new CustomEvent('cvfx:score-request'));
  });
}

// ── 工具 ─────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── 导出 ─────────────────────────────────────────────────────
window.__cvfx = window.__cvfx || {};
Object.assign(window.__cvfx, {
  mountOverlay,
  unmountOverlay,
  renderOverlay,
});
