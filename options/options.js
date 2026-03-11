/**
 * CVFilterX - Options Page
 * 四个 Tab：API 设置、字段配置、评分模板、高级设置
 */

const $ = id => document.getElementById(id);

// DEFAULT_DIMENSIONS comes from lib/constants.js (loaded via <script>)

let settings = {};
let currentTemplates = {};
let editingTemplateId = null;

// ── 初始化 ────────────────────────────────────────────────────
async function init() {
  const res = await sendMsg(MSG.GET_SETTINGS);
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
  try {
    const res = await sendMsg(MSG.TEST_CONNECTION, { settings: cfg });
    btn.disabled = false;
    showFeedback('test-result', 'ok', `OK ${res.result}`);
  } catch (e) {
    btn.disabled = false;
    showFeedback('test-result', 'err', `FAIL: ${e.message}`);
  }
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
  try {
    const res = await sendMsg(MSG.GET_TEMPLATES);
    currentTemplates = res.templates;
    renderTemplateList();
  } catch { /* ignore */ }
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
            ${!t.isDefault ? `<button class="btn secondary btn-xs tpl-set-default" data-id="${t.id}">设为默认</button>` : ''}
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
  list.querySelectorAll('.tpl-set-default').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await sendMsg(MSG.SET_DEFAULT_TEMPLATE, { templateId: btn.dataset.id });
        showFeedback('save-template-result', 'ok', 'OK 已设为默认');
        setTimeout(() => showFeedback('save-template-result', '', ''), 2000);
        await loadTemplates();
      } catch (e) {
        showFeedback('save-template-result', 'err', `FAIL: ${e.message}`);
      }
    });
  });
  list.querySelectorAll('.tpl-clone').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await sendMsg(MSG.CLONE_TEMPLATE, { templateId: btn.dataset.id });
        showFeedback('save-template-result', 'ok', 'OK 已克隆');
        setTimeout(() => showFeedback('save-template-result', '', ''), 2000);
        await loadTemplates();
      } catch (e) {
        showFeedback('save-template-result', 'err', `FAIL: ${e.message}`);
      }
    });
  });
  list.querySelectorAll('.tpl-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('确认删除该模板？关联的职位将需要重新选择模板。')) return;
      try {
        await sendMsg(MSG.DELETE_TEMPLATE, { templateId: btn.dataset.id });
        showFeedback('save-template-result', 'ok', 'OK 已删除');
        setTimeout(() => showFeedback('save-template-result', '', ''), 2000);
        await loadTemplates();
      } catch (e) {
        showFeedback('save-template-result', 'err', `FAIL: ${e.message}`);
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
    renderModalDimensions(t.dimensionConfig ?? DEFAULT_DIMENSIONS);
    fillPromptSections(t.promptSections);
  } else {
    $('modal-title').textContent = '新建模板';
    $('tpl-name').value = '';
    $('tpl-desc').value = '';
    $('tpl-keywords').value = '';
    renderModalDimensions(DEFAULT_DIMENSIONS);
    fillPromptSections(null);
  }

  // 清除关键词测试状态
  $('tpl-keyword-test-input').value = '';
  $('keyword-test-result').textContent = '';
  $('keyword-test-result').className = 'keyword-test-result';
}

function fillPromptSections(sections) {
  const s = sections ?? {};
  $('tpl-ps-roleSetup').value = s.roleSetup ?? PROMPT_SECTION_DEFAULTS.roleSetup;
  $('tpl-ps-taskGuide').value = s.taskGuide ?? PROMPT_SECTION_DEFAULTS.taskGuide;
  $('tpl-ps-outputRules').value = s.outputRules ?? PROMPT_SECTION_DEFAULTS.outputRules;
}

function getPromptSectionsFromDOM() {
  const roleSetup = $('tpl-ps-roleSetup').value.trim();
  const taskGuide = $('tpl-ps-taskGuide').value.trim();
  const outputRules = $('tpl-ps-outputRules').value.trim();

  // 如果内容和默认值一致，存 null（表示使用默认）
  return {
    roleSetup: roleSetup === PROMPT_SECTION_DEFAULTS.roleSetup ? null : (roleSetup || null),
    taskGuide: taskGuide === PROMPT_SECTION_DEFAULTS.taskGuide ? null : (taskGuide || null),
    outputRules: outputRules === PROMPT_SECTION_DEFAULTS.outputRules ? null : (outputRules || null),
  };
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
  if (!name) { showToast('请填写模板名称', 'warning'); return; }

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
    promptSections: getPromptSectionsFromDOM(),
    promptTemplate: '',  // 清空旧字段，新模式使用 promptSections
    matchKeywords,
  };

  // 保留已有模板的 isDefault 状态
  if (editingTemplateId && currentTemplates[editingTemplateId]) {
    template.isDefault = currentTemplates[editingTemplateId].isDefault;
  }

  try {
    await sendMsg(MSG.SAVE_TEMPLATE, { template });
    closeModal();
    showFeedback('save-template-result', 'ok', 'OK 已保存');
    setTimeout(() => showFeedback('save-template-result', '', ''), 2000);
    await loadTemplates();
  } catch (e) {
    showToast(`保存失败：${e.message}`, 'error');
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
  try {
    await sendMsg(MSG.SAVE_SETTINGS, { settings: partial });
    Object.assign(settings, partial);
    showFeedback(feedbackId, 'ok', 'OK 已保存');
    setTimeout(() => showFeedback(feedbackId, '', ''), 3000);
  } catch (e) {
    showFeedback(feedbackId, 'err', `FAIL: ${e.message}`);
  }
}

function showFeedback(id, cls, text) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `feedback ${cls}`;
}

// esc() is an alias for escHtml() from lib/utils.js
function esc(str) { return escHtml(str ?? ''); }

// ── Prompt 预览 ─────────────────────────────────────────────────
$('btn-prompt-preview').addEventListener('click', () => {
  const dims = getModalDimsFromDOM();
  const dimsText = dims
    .map(d => `- key="${d.key}"  ${d.label}（权重 ${d.weight}%）：${d.description}`)
    .join('\n');

  const dimSchema = dims
    .map(d => `    "${d.key}": { "score": <0-10整数>, "comment": "<理由>" }`)
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

  const sections = getPromptSectionsFromDOM();
  const role = sections.roleSetup ?? PROMPT_SECTION_DEFAULTS.roleSetup;
  const task = sections.taskGuide ?? PROMPT_SECTION_DEFAULTS.taskGuide;
  const rules = sections.outputRules ?? PROMPT_SECTION_DEFAULTS.outputRules;

  const preview = `${role}

## 任务说明

${task}

---

## 岗位描述
【运行时将填入实际岗位描述 JD】

## 候选人简历
【运行时将填入实际候选人简历数据（JSON 格式）】

## 评估维度（请对每个维度打分 0-10）
${dimsText}

## 输出格式（严格 JSON，dimensionKey 与上方维度 key 对应）
${schema}

${rules}`;

  $('prompt-preview-text').value = preview;
  $('prompt-preview-modal').style.display = '';
});

$('prompt-preview-close').addEventListener('click', () => {
  $('prompt-preview-modal').style.display = 'none';
});
$('prompt-preview-ok').addEventListener('click', () => {
  $('prompt-preview-modal').style.display = 'none';
});
$('prompt-preview-backdrop').addEventListener('click', () => {
  $('prompt-preview-modal').style.display = 'none';
});

// ── Prompt 恢复默认 ──────────────────────────────────────────────
document.querySelectorAll('.prompt-reset').forEach(btn => {
  btn.addEventListener('click', () => {
    const section = btn.dataset.section;
    const textarea = $(`tpl-ps-${section}`);
    if (textarea && PROMPT_SECTION_DEFAULTS[section]) {
      textarea.value = PROMPT_SECTION_DEFAULTS[section];
    }
  });
});

// ── 关键词匹配测试 ──────────────────────────────────────────────
$('btn-keyword-test').addEventListener('click', () => {
  const testTitle = $('tpl-keyword-test-input').value.trim();
  const keywordsStr = $('tpl-keywords').value.trim();
  const resultEl = $('keyword-test-result');

  if (!testTitle) {
    resultEl.textContent = '请输入职位标题';
    resultEl.className = 'keyword-test-result no-match';
    return;
  }

  if (!keywordsStr) {
    resultEl.textContent = '未设置关键词';
    resultEl.className = 'keyword-test-result no-match';
    return;
  }

  const keywords = keywordsStr.split(/[,，]/).map(k => k.trim()).filter(Boolean);
  const title = testTitle.toLowerCase();
  const matched = keywords.filter(kw => title.includes(kw.toLowerCase()));

  if (matched.length > 0) {
    resultEl.textContent = `匹配到 ${matched.length} 个关键词：${matched.join(', ')}`;
    resultEl.className = 'keyword-test-result match';
  } else {
    resultEl.textContent = '未匹配到任何关键词';
    resultEl.className = 'keyword-test-result no-match';
  }
});

// ── 启动 ──────────────────────────────────────────────────────
init();
