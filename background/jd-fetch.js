/**
 * CVFilterX - JD Page Fetching
 * Opens background tab to scrape JD from /hire/job/{id}
 */

async function fetchAndCacheJD(jobId, origin, senderTabId) {
  // 防御层 1：cache-first
  const cachedData = await chrome.storage.local.get('jobs');
  const existingJob = cachedData.jobs?.[jobId];
  if (existingJob?.rawJD && !existingJob.partial) {
    console.log(`[CVFilterX] fetchAndCacheJD cache hit: ${jobId}`);
    return existingJob;
  }

  const jobUrl = `${origin}/hire/job/${jobId}?activeTab=basicInfo`;

  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: jobUrl, active: false }, (newTab) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }

      // 防御层 2：校验 newTab.id !== senderTabId
      console.log(`[CVFilterX] fetchAndCacheJD senderTabId=${senderTabId} newTabId=${newTab.id}`);
      if (senderTabId && newTab.id === senderTabId) {
        console.error('[CVFilterX] fetchAndCacheJD: newTab.id === senderTabId, aborting tab removal');
      }

      let settled = false;

      // 防御层 3：safeRemoveTab
      const safeRemoveTab = () => {
        if (senderTabId && newTab.id === senderTabId) {
          console.error('[CVFilterX] safeRemoveTab: blocked removal of sender tab');
          return;
        }
        chrome.tabs.remove(newTab.id).catch(() => {});
      };

      const cleanup = () => {
        chrome.tabs.onUpdated.removeListener(listener);
        safeRemoveTab();
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('fetchAndCacheJD timeout'));
      }, 20000);

      const listener = async (tabId, info) => {
        if (tabId !== newTab.id || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);

        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: newTab.id },
            func: async () => {
              for (let i = 0; i < 5; i++) {
                const panels = document.querySelectorAll(
                  '.job-showcase-panel-item',
                );
                for (const p of panels) {
                  const t = p.innerText || '';
                  if (t.includes('职位描述') || t.includes('职位名称')) {
                    const lines = t
                      .split(/\n/)
                      .map((l) => l.trim())
                      .filter(Boolean);
                    const idx = lines.indexOf('职位名称');
                    const title = idx >= 0 ? lines[idx + 1] : '';
                    return { rawJD: t, jobTitle: title };
                  }
                }
                if (i < 4) await new Promise((r) => setTimeout(r, 1000));
              }
              return null;
            },
          });

          if (settled) return;
          settled = true;
          clearTimeout(timer);

          const jdData = results?.[0]?.result;
          if (jdData?.rawJD) {
            const jobData = {
              jobId,
              jobTitle: jdData.jobTitle || '未知职位',
              rawJD: jdData.rawJD,
              capturedAt: Date.now(),
            };
            await saveJobData(jobData);
            cleanup();
            resolve(jobData);
          } else {
            cleanup();
            reject(new Error('JD 内容未找到，页面可能尚未渲染'));
          }
        } catch (e) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cleanup();
          reject(e);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}
