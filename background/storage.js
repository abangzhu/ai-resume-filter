/**
 * CVFilterX - Background Storage Operations
 * Settings, scores, job data persistence
 */

async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
}

async function saveSettings(partial) {
  const current = await getSettings();
  await chrome.storage.local.set({ settings: { ...current, ...partial } });
}

async function saveScore(result) {
  const data = await chrome.storage.local.get('scores');
  const scores = { ...(data.scores ?? {}), [result.candidateId]: result };
  await chrome.storage.local.set({ scores });
}

async function getScores(candidateIds) {
  const data = await chrome.storage.local.get('scores');
  const scores = data.scores ?? {};
  if (!candidateIds) return scores;
  return Object.fromEntries(candidateIds.map((id) => [id, scores[id] ?? null]));
}

async function saveJobData(jobData) {
  const data = await chrome.storage.local.get('jobs');
  const jobs = { ...(data.jobs ?? {}), [jobData.jobId]: jobData };
  await chrome.storage.local.set({ jobs });
}
