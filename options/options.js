/**
 * CVFilterX - Options Page
 * 四个 Tab：API 设置、字段配置、评分模板、高级设置
 */

const $ = id => document.getElementById(id);

const DEFAULT_DIMS = [
  { key: 'educationMatch',  label: '学历匹配',  description: '候选人学历、专业与岗位要求的匹配程度', weight: 20 },
  { key: 'experienceMatch', label: '经验匹配',  description: '工作年限、行业背景与岗位要求的匹配程度', weight: 30 },
  { key: 'skillMatch',      label: '技能匹配',  description: '技术技能、工具与岗位要求的匹配程度',     weight: 30 },
  { key: 'stability',       label: '工作稳定性', description: '历史工作年限分布，评估跳槽频率',         weight: 10 },
  { key: 'growthPotential', label: '成长潜力',  description: '职业发展轨迹、晋升节奏与成长空间',       weight: 10 },
];

let settings = {};
let currentTemplates = {};
let editingTemplateId = null;

// ── 初始化 ────────────────────────────────────────────────────
async function init() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  settings = res.settings;

  // Tab 1: API
  $('apiKey').value  = settings.apiKey  ?? '';
  $('baseUrl').value = settings.baseUrl ?? 'https://api.openai.com/v1';
  $('model').value   = settings.model   ?? 'gpt-4o-mini';
  syncChips(settings.model ?? 'gpt-4o-mini');

  // Tab 2: 字段配置
  const fc = settings.fieldConfig ?? {};
  $('field-basicInfo').checked         = fc.basicInfo         !== false;
  $('field-workExperience').checked    = fc.workExperience    !== false;
  $('field-education').checked         = fc.education         !== false;
  $('field-skills').checked            = fc.skills            !== false;
  $('field-selfIntroduction').checked  = fc.selfIntroduction  !== false;

  // Tab 3: 评分模板
  await loadTemplates();

  // Tab 4: 高级设置
  $('autoPaginateDelay').value = settings.autoPaginateDelay ?? 2000;
  $('skipScored').checked      = settings.skipScored        !== false;
  $('cacheExpireDays').value   = settings.cacheExpireDays   ?? 7;
}

// ── Tab 切换 ──────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`)?.classList.add('active');
  });
});

// ── Tab 1: API 设置 ──────────────────────────────────────────
function syncChips(model) {
  document.querySelectorAll('.chip[data-model]').forEach(c => {
    c.classList.toggle('active', c.dataset.model === model);
  });
}
document.querySelectorAll('.chip[data-model]').forEach(c => {
  c.addEventListener('click', () => { $('model').value = c.dataset.model; syncChips(c.dataset.model); });
});
$('model').addEventListener('input', () => syncChips($('model').value));

$('btn-save-api').addEventListener('click', async () => {
  await save({
    apiKey:  $('apiKey').value.trim(),
    baseUrl: $('baseUrl').value.trim() || 'https://api.openai.com/v1',
    model:   $('model').value.trim()   || 'gpt-4o-mini',
  }, 'save-api-result');
});

$('btn-test').addEventListener('click', async () => {
  const btn = $('btn-test');
  const cfg = {
    apiKey:  $('apiKey').value.trim(),
    baseUrl: $('baseUrl').value.trim() || 'https://api.openai.com/v1',
    model:   $('model').value.trim()   || 'gpt-4o-mini',
  };
  if (!cfg.apiKey) { showFeedback('test-result', 'err', 'Please fill API Key first'); return; }

  btn.disabled = true;
  showFeedback('test-result', '', '连接中...');
  const res = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION', settings: cfg });
  btn.disabled = false;
  res.ok
    ? showFeedback('test-result', 'ok', `OK ${res.result}`)
    : showFeedback('test-result', 'err', `FAIL: ${res.error}`);
});

// ── Tab 2: 字段配置 ──────────────────────────────────────────
$('btn-save-fields').addEventListener('click', async () => {
  await save({
    fieldConfig: {
      basicInfo:        $('field-basicInfo').checked,
      workExperience:   $('field-workExperience').checked,
      education:        $('field-education').checked,
      skills:           $('field-skills').checked,
      selfIntroduction: $('field-selfIntroduction').checked,
    },
  }, 'save-fields-result');
});

// ── Tab 3: 评分模板 ──────────────────────────────────────────
async function loadTemplates() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_TEMPLATES' });
  if (res.ok) {
    currentTemplates = res.templates;
    renderTemplateList();
  }
}

function renderTemplateList() {
  const list = $('template-list');
  const templates = Object.values(currentTemplates).sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });

  if (templates.length === 0) {
    list.innerHTML = '<div class="template-empty">暂无模板，点击上方按钮新建。</div>';
    return;
  }

  list.innerHTML = templates.map(t => {
    const dimCount = (t.dimensionConfig ?? []).length;
    const keywords = (t.matchKeywords ?? []).join(', ') || '无';
    const defaultBadge = t.isDefault ? '<span class="badge badge-default">默认</span>' : '';
    return `
      <div class="template-card" data-id="${t.id}">
        <div class="template-card-header">
          <div class="template-card-title">
            <strong>${esc(t.name)}</strong>
            ${defaultBadge}
          </div>
          <div class="template-actions">
            <button class="btn secondary btn-xs tpl-edit" data-id="${t.id}">编辑</button>
            <button class="btn secondary btn-xs tpl-clone" data-id="${t.id}">克隆</button>
            <button class="btn danger btn-xs tpl-delete" data-id="${t.id}">删除</button>
          </div>
        </div>
        <div class="template-card-body">
          <div class="template-meta">${esc(t.description || '无描述')}</div>
          <div class="template-meta"><span class="meta-label">维度数：</span>${dimCount}</div>
          <div class="template-meta"><span class="meta-label">匹配词：</span>${esc(keywords)}</div>
        </div>
      </div>
    `;
  }).join('');

  // 绑定卡片事件
  list.querySelectorAll('.tpl-edit').forEach(btn => {
    btn.addEventListener('click', () => openTemplateEditor(btn.dataset.id));
  });
  list.querySelectorAll('.tpl-clone').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await chrome.runtime.sendMessage({ type: 'CLONE_TEMPLATE', templateId: btn.dataset.id });
      if (res.ok) {
        showFeedback('save-template-result', 'ok', 'OK 已克隆');
        setTimeout(() => showFeedback('save-template-result', '', ''), 2000);
        await loadTemplates();
      } else {
        showFeedback('save-template-result', 'err', `FAIL: ${res.error}`);
      }
    });
  });
  list.querySelectorAll('.tpl-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('确认删除该模板？关联的职位将需要重新选择模板。')) return;
      const res = await chrome.runtime.sendMessage({ type: 'DELETE_TEMPLATE', templateId: btn.dataset.id });
      if (res.ok) {
        showFeedback('save-template-result', 'ok', 'OK 已删除');
        setTimeout(() => showFeedback('save-template-result', '', ''), 2000);
        await loadTemplates();
      } else {
        showFeedback('save-template-result', 'err', `FAIL: ${res.error}`);
      }
    });
  });
}

$('btn-add-template').addEventListener('click', () => openTemplateEditor(null));

function openTemplateEditor(templateId) {
  editingTemplateId = templateId;
  const modal = $('template-modal');
  modal.style.display = '';

  if (templateId && currentTemplates[templateId]) {
    const t = currentTemplates[templateId];
    $('modal-title').textContent = '编辑模板';
    $('tpl-name').value = t.name ?? '';
    $('tpl-desc').value = t.description ?? '';
    $('tpl-keywords').value = (t.matchKeywords ?? []).join(', ');
    $('tpl-prompt').value = t.promptTemplate ?? '';
    renderModalDimensions(t.dimensionConfig ?? DEFAULT_DIMS);
  } else {
    $('modal-title').textContent = '新建模板';
    $('tpl-name').value = '';
    $('tpl-desc').value = '';
    $('tpl-keywords').value = '';
    $('tpl-prompt').value = '';
    renderModalDimensions(DEFAULT_DIMS);
  }
}

function closeModal() {
  $('template-modal').style.display = 'none';
  editingTemplateId = null;
}

$('modal-close').addEventListener('click', closeModal);
$('btn-modal-cancel').addEventListener('click', closeModal);
$('template-modal').querySelector('.modal-backdrop').addEventListener('click', closeModal);

// ── Modal 维度编辑 ────────────────────────────────────────────
function renderModalDimensions(dims) {
  const list = $('modal-dim-list');
  list.innerHTML = `
    <div class="dim-header">
      <span>维度名称</span>
      <span>评估描述（用于 Prompt）</span>
      <span>权重</span>
      <span></span>
    </div>
  `;
  dims.forEach((d, i) => list.appendChild(buildEditorDimRow(d, i)));
  updateModalWeightTotal();
}

function buildEditorDimRow(dim, idx) {
  const row = document.createElement('div');
  row.className = 'dim-row';
  row.dataset.idx = idx;
  row.dataset.key = dim.key || `dim_${idx}`;
  row.innerHTML = `
    <input type="text" class="dim-label" placeholder="维度名称" value="${esc(dim.label)}">
    <input type="text" class="dim-desc"  placeholder="描述（写进 Prompt 指导 LLM 评分）" value="${esc(dim.description)}">
    <div class="dim-weight-wrap">
      <input type="number" class="dim-weight" min="1" max="100" value="${dim.weight}">
      <span>%</span>
    </div>
    <button class="dim-del" title="删除">x</button>
  `;
  row.querySelector('.dim-weight').addEventListener('input', updateModalWeightTotal);
  row.querySelector('.dim-del').addEventListener('click', () => {
    row.remove();
    updateModalWeightTotal();
  });
  return row;
}

function updateModalWeightTotal() {
  const total = getModalDimsFromDOM().reduce((s, d) => s + d.weight, 0);
  $('modal-weight-total').textContent = total;
  $('modal-weight-warn').style.display = total !== 100 ? '' : 'none';
}

function getModalDimsFromDOM() {
  return Array.from($('modal-dim-list').querySelectorAll('.dim-row')).map((row, i) => ({
    key:         row.dataset.key || `dim_${i}`,
    label:       row.querySelector('.dim-label').value.trim() || `维度${i + 1}`,
    description: row.querySelector('.dim-desc').value.trim(),
    weight:      parseInt(row.querySelector('.dim-weight').value) || 0,
  }));
}

$('btn-modal-add-dim').addEventListener('click', () => {
  const list = $('modal-dim-list');
  const rows = list.querySelectorAll('.dim-row');
  list.appendChild(buildEditorDimRow({ label: '', description: '', weight: 10 }, rows.length));
  updateModalWeightTotal();
});

$('btn-modal-save').addEventListener('click', async () => {
  const name = $('tpl-name').value.trim();
  if (!name) { alert('请填写模板名称'); return; }

  const dims = getModalDimsFromDOM();
  const total = dims.reduce((s, d) => s + d.weight, 0);
  if (total !== 100) {
    if (!confirm(`当前总权重为 ${total}%（建议 100%），是否仍然保存？`)) return;
  }

  const keywordsStr = $('tpl-keywords').value.trim();
  const matchKeywords = keywordsStr
    ? keywordsStr.split(/[,，]/).map(k => k.trim()).filter(Boolean)
    : [];

  const template = {
    id: editingTemplateId || undefined,
    name,
    description: $('tpl-desc').value.trim(),
    dimensionConfig: dims,
    promptTemplate: $('tpl-prompt').value,
    matchKeywords,
  };

  // 保留已有模板的 isDefault 状态
  if (editingTemplateId && currentTemplates[editingTemplateId]) {
    template.isDefault = currentTemplates[editingTemplateId].isDefault;
  }

  const res = await chrome.runtime.sendMessage({ type: 'SAVE_TEMPLATE', template });
  if (res.ok) {
    closeModal();
    showFeedback('save-template-result', 'ok', 'OK 已保存');
    setTimeout(() => showFeedback('save-template-result', '', ''), 2000);
    await loadTemplates();
  } else {
    alert(`保存失败：${res.error}`);
  }
});

// ── Tab 4: 高级设置 ──────────────────────────────────────────
$('btn-save-advanced').addEventListener('click', async () => {
  const delay = parseInt($('autoPaginateDelay').value);
  await save({
    autoPaginateDelay: isNaN(delay) ? 2000 : Math.min(10000, Math.max(500, delay)),
    skipScored:        $('skipScored').checked,
    cacheExpireDays:   parseInt($('cacheExpireDays').value) || 0,
  }, 'save-advanced-result');
});

// ── 共用 save ─────────────────────────────────────────────────
async function save(partial, feedbackId) {
  showFeedback(feedbackId, '', '保存中...');
  const res = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: partial });
  if (res.ok) {
    Object.assign(settings, partial);
    showFeedback(feedbackId, 'ok', 'OK 已保存');
    setTimeout(() => showFeedback(feedbackId, '', ''), 3000);
  } else {
    showFeedback(feedbackId, 'err', `FAIL: ${res.error}`);
  }
}

function showFeedback(id, cls, text) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `feedback ${cls}`;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── 启动 ──────────────────────────────────────────────────────
init();
