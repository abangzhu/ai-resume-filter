/**
 * CVFilterX - Background Service Worker
 * Message router only. All logic lives in imported modules.
 */

importScripts(
  '../lib/constants.js',
  '../lib/utils.js',
  'storage.js',
  'templates.js',
  'llm.js',
  'capture.js',
  'jd-fetch.js'
);

// ── API 连通性测试 ───────────────────────────────────────────
async function testConnection(settings) {
  const response = await fetch(`${settings.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${settings.apiKey}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${response.status} ${body.slice(0, 100)}`);
  }
  return '连接成功';
}

// ── 消息路由 ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const ok = (data) => sendResponse({ ok: true, ...data });
  const fail = (err) => sendResponse({ ok: false, error: err.message });

  switch (message.type) {
    case MSG.SCORE_RESUME:
      handleScoreResume(message.resumeData, message.jobData, message.templateId)
        .then((result) => ok({ result }))
        .catch(fail);
      return true;

    case MSG.GET_SETTINGS:
      getSettings().then((settings) => ok({ settings })).catch(fail);
      return true;

    case MSG.SAVE_SETTINGS:
      saveSettings(message.settings).then(() => ok({})).catch(fail);
      return true;

    case MSG.GET_SCORES:
      getScores(message.candidateIds).then((scores) => ok({ scores })).catch(fail);
      return true;

    case MSG.TEST_CONNECTION:
      testConnection(message.settings).then((result) => ok({ result })).catch(fail);
      return true;

    case MSG.FETCH_JD:
      fetchAndCacheJD(message.jobId, message.origin, sender.tab?.id)
        .then((jobData) => ok({ jobData }))
        .catch(fail);
      return true;

    case MSG.CAPTURE_RESUME_IMAGE:
      captureResumeImage(sender.tab?.id, message.rect, message.dpr ?? 1)
        .then((imageBase64) => ok({ imageBase64 }))
        .catch(fail);
      return true;

    case MSG.OPEN_OPTIONS:
      chrome.runtime.openOptionsPage();
      ok({});
      break;

    case MSG.SCORE_RESULT:
      ok({});
      break;

    // ── Template messages ──────────────────────────────────
    case MSG.GET_TEMPLATES:
      getTemplates().then((templates) => ok({ templates })).catch(fail);
      return true;

    case MSG.SAVE_TEMPLATE:
      saveTemplate(message.template).then((template) => ok({ template })).catch(fail);
      return true;

    case MSG.DELETE_TEMPLATE:
      deleteTemplate(message.templateId).then(() => ok({})).catch(fail);
      return true;

    case MSG.CLONE_TEMPLATE:
      cloneTemplate(message.templateId).then((template) => ok({ template })).catch(fail);
      return true;

    case MSG.GET_JOB_TEMPLATE:
      getJobTemplate(message.jobId).then((result) => ok({ jobTemplate: result })).catch(fail);
      return true;

    case MSG.SET_JOB_TEMPLATE:
      setJobTemplate(message.jobId, message.templateId).then(() => ok({})).catch(fail);
      return true;

    case MSG.MATCH_TEMPLATE:
      getTemplates()
        .then((templates) => ok({ template: matchTemplate(message.jobTitle, templates) }))
        .catch(fail);
      return true;

    case MSG.SET_DEFAULT_TEMPLATE:
      setDefaultTemplate(message.templateId).then(() => ok({})).catch(fail);
      return true;

    default:
      sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
  }
});
