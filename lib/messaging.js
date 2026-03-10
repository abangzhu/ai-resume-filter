/**
 * CVFilterX - Unified Messaging
 * Wraps chrome.runtime.sendMessage / chrome.tabs.sendMessage
 * with consistent { ok, error } response handling
 */

async function sendMsg(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (response && !response.ok && response.error) {
    throw new Error(response.error);
  }
  return response;
}

async function sendTabMsg(tabId, type, payload = {}, _retryCount = 0) {
  const MAX_RETRIES = 3;
  const BASE_DELAY = 300;
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type, ...payload });
    if (response && !response.ok && response.error) {
      throw new Error(response.error);
    }
    return response;
  } catch (err) {
    const isConnectionError =
      err.message?.includes('Could not establish connection') ||
      err.message?.includes('Receiving end does not exist');
    if (isConnectionError && _retryCount < MAX_RETRIES) {
      await sleep(BASE_DELAY * Math.pow(2, _retryCount));
      return sendTabMsg(tabId, type, payload, _retryCount + 1);
    }
    throw err;
  }
}
