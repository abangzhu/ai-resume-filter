/**
 * CVFilterX - Template System
 * CRUD operations, migration, matching
 */

// ── 模板系统：迁移逻辑 ──────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  await migrateToTemplateSystem();
});

async function migrateToTemplateSystem() {
  const data = await chrome.storage.local.get(['templates', 'settings']);

  if (data.templates && Object.keys(data.templates).length > 0) return;

  const settings = data.settings ?? {};
  const dimConfig = settings.dimensionConfig ?? DEFAULT_DIMENSIONS;
  const promptTemplate = settings.promptTemplate ?? '';

  const defaultTemplateId = generateUUID();
  const now = Date.now();

  const templates = {
    [defaultTemplateId]: {
      id: defaultTemplateId,
      name: '默认模板',
      description: '通用候选人评估模板',
      dimensionConfig: dimConfig,
      promptTemplate,
      matchKeywords: [],
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
  };

  await chrome.storage.local.set({ templates });

  const { dimensionConfig: _d, promptTemplate: _p, ...cleanSettings } = settings;
  await chrome.storage.local.set({ settings: cleanSettings });

  console.log('[CVFilterX] 模板系统迁移完成，默认模板 ID:', defaultTemplateId);
}

// ── 模板系统：CRUD ──────────────────────────────────────────
async function getTemplates() {
  const data = await chrome.storage.local.get('templates');
  const templates = data.templates ?? {};

  if (Object.keys(templates).length === 0) {
    await migrateToTemplateSystem();
    const fresh = await chrome.storage.local.get('templates');
    return fresh.templates ?? {};
  }

  return templates;
}

async function saveTemplate(template) {
  const templates = await getTemplates();
  const now = Date.now();

  if (!template.id) {
    template = { ...template, id: generateUUID(), createdAt: now };
  }

  const updated = {
    ...templates,
    [template.id]: {
      ...templates[template.id],
      ...template,
      updatedAt: now,
    },
  };

  await chrome.storage.local.set({ templates: updated });
  return updated[template.id];
}

async function setDefaultTemplate(templateId) {
  const templates = await getTemplates();
  if (!templates[templateId]) throw new Error('模板不存在。');

  const updated = Object.fromEntries(
    Object.entries(templates).map(([id, t]) => [
      id,
      { ...t, isDefault: id === templateId },
    ]),
  );

  await chrome.storage.local.set({ templates: updated });
}

async function deleteTemplate(templateId) {
  const templates = await getTemplates();

  if (Object.keys(templates).length <= 1) {
    throw new Error('至少保留一个模板，无法删除唯一模板。');
  }

  if (!templates[templateId]) {
    throw new Error('模板不存在。');
  }

  const wasDefault = templates[templateId].isDefault;
  const remaining = { ...templates };
  delete remaining[templateId];

  if (wasDefault) {
    const firstKey = Object.keys(remaining)[0];
    remaining[firstKey] = { ...remaining[firstKey], isDefault: true };
  }

  await chrome.storage.local.set({ templates: remaining });

  const jtData = await chrome.storage.local.get('jobTemplates');
  const jobTemplates = jtData.jobTemplates ?? {};
  const cleaned = Object.fromEntries(
    Object.entries(jobTemplates).filter(([, v]) => v.templateId !== templateId),
  );
  await chrome.storage.local.set({ jobTemplates: cleaned });
}

async function cloneTemplate(templateId) {
  const templates = await getTemplates();
  const source = templates[templateId];
  if (!source) throw new Error('源模板不存在。');

  const now = Date.now();
  const newId = generateUUID();
  const cloned = {
    ...source,
    id: newId,
    name: `${source.name}（副本）`,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };

  const updated = { ...templates, [newId]: cloned };
  await chrome.storage.local.set({ templates: updated });
  return cloned;
}

async function getJobTemplate(jobId) {
  const data = await chrome.storage.local.get('jobTemplates');
  const jobTemplates = data.jobTemplates ?? {};
  return jobTemplates[jobId] ?? null;
}

async function setJobTemplate(jobId, templateId) {
  const data = await chrome.storage.local.get('jobTemplates');
  const jobTemplates = {
    ...(data.jobTemplates ?? {}),
    [jobId]: {
      templateId,
      confirmedAt: Date.now(),
    },
  };
  await chrome.storage.local.set({ jobTemplates });
}

function matchTemplate(jobTitle, templates) {
  if (!jobTitle) return null;

  const title = jobTitle.toLowerCase();
  let bestMatch = null;
  let bestCount = 0;

  for (const t of Object.values(templates)) {
    if (!t.matchKeywords || t.matchKeywords.length === 0) continue;
    const count = t.matchKeywords.filter((kw) =>
      title.includes(kw.toLowerCase()),
    ).length;
    if (count > bestCount) {
      bestCount = count;
      bestMatch = t;
    }
  }

  return bestMatch;
}
