/**
 * CVFilterX - Content Script Storage Helpers
 * Convenience wrappers for common storage operations
 * used from content scripts (delegates to background via messaging)
 */

async function cvfxGetSettings() {
  const res = await sendMsg(MSG.GET_SETTINGS);
  return res?.settings ?? {};
}

async function cvfxGetCachedScore(talentId, settings) {
  if (!talentId) return null;
  const d = await chrome.storage.local.get('scores');
  const score = d.scores?.[talentId];
  if (!score) return null;
  const days = settings.cacheExpireDays ?? 7;
  if (days > 0 && !isFresh(score.scoredAt, days)) return null;
  return score;
}

async function cvfxCacheJobData(jobData) {
  const d = await chrome.storage.local.get('jobs');
  const jobs = { ...(d.jobs ?? {}), [jobData.jobId]: jobData };
  await chrome.storage.local.set({ jobs });
}
