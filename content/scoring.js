/**
 * CVFilterX - Scoring Logic
 * scoreCandidate, captureResumeImage, getJobData, getCurrentTemplateInfo
 * Extracted from content.js
 */

async function scoreCandidate(settings, explicitTemplateId, afterScore) {
  const cvfx = window.__cvfx;

  if (!settings.apiKey) {
    cvfx.renderOverlay('error', { error: 'API Key 未配置，请打开设置页填写。' });
    sendMsg(MSG.OPEN_OPTIONS).catch(() => {});
    if (afterScore) afterScore(null, new Error('API Key 未配置'));
    return;
  }

  let templateId = explicitTemplateId;

  if (!templateId) {
    const resumeData = cvfx.extractResumeData(settings.fieldConfig);
    const jobId = resumeData.jobId;
    if (jobId) {
      try {
        const jtRes = await sendMsg(MSG.GET_JOB_TEMPLATE, { jobId });
        if (jtRes?.jobTemplate) {
          templateId = jtRes.jobTemplate.templateId;
        }
      } catch { /* ignore */ }
    }

    if (!templateId) {
      let tplRes;
      try { tplRes = await sendMsg(MSG.GET_TEMPLATES); }
      catch {
        cvfx.renderOverlay('error', { error: '加载模板失败' });
        if (afterScore) afterScore(null, new Error('加载模板失败'));
        return;
      }

      const templates = tplRes.templates;
      const tplList = Object.values(templates);

      if (tplList.length === 1) {
        templateId = tplList[0].id;
      } else {
        const jobTitle = document.querySelector(cvfx.SELECTORS.candidate.jobInfo)?.innerText?.split('\n')[0] || '';
        let suggested = null;
        if (jobTitle) {
          try {
            const matchRes = await sendMsg(MSG.MATCH_TEMPLATE, { jobTitle });
            if (matchRes?.template) suggested = matchRes.template;
          } catch { /* ignore */ }
        }

        const chosen = await showTemplateDialog(jobTitle, tplList, suggested);
        if (!chosen) {
          cvfx.renderOverlay('idle');
          if (afterScore) afterScore(null, new Error('用户取消选择模板'));
          return;
        }
        templateId = chosen;
      }

      const jd = cvfx.extractResumeData(settings.fieldConfig);
      if (jd.jobId) {
        await sendMsg(MSG.SET_JOB_TEMPLATE, { jobId: jd.jobId, templateId });
      }
    }
  }

  cvfx.renderOverlay('loading');

  try {
    const resumeData = cvfx.extractResumeData(settings.fieldConfig);

    // 图片 fallback：不可变模式
    if ((resumeData.resumeText ?? '').length < 100) {
      try {
        const imageBase64 = await cvfxCaptureResumeImage();
        if (imageBase64) {
          resumeData.resumeImageBase64 = imageBase64;
          console.log('[CVFilterX] 简历文本不足，已截图作为 fallback');
        }
      } catch (e) {
        console.warn('[CVFilterX] 简历截图失败:', e.message);
      }
    }

    const jobData = await cvfxGetJobData(resumeData.jobId);

    const candidateId = resumeData.candidateId;
    const response = await withScoringTimeout(
      sendMsg(MSG.SCORE_RESUME, { resumeData, jobData, templateId }),
      candidateId, settings
    );

    const resultWithRank = await attachRankInfo(response.result);
    cvfx.renderOverlay('scored', { result: resultWithRank });
    sendMsg(MSG.SCORE_RESULT, { result: response.result }).catch(() => {});
    if (afterScore) afterScore(response.result, null);
  } catch (err) {
    console.error('[CVFilterX] 评分失败', err);
    cvfx.renderOverlay('error', { error: err.message });
    if (afterScore) afterScore(null, err);
  }
}

async function cvfxCaptureResumeImage() {
  const cvfx = window.__cvfx;
  const sel = cvfx.SELECTORS.candidate.resumeTabContent;
  const el = document.querySelector(sel);
  if (!el) return null;

  el.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  await new Promise(r => setTimeout(r, 400));

  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  const res = await sendMsg(MSG.CAPTURE_RESUME_IMAGE, {
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    dpr,
  });
  return res.imageBase64;
}

async function cvfxGetJobData(jobId) {
  const cvfx = window.__cvfx;
  if (jobId) {
    const d = await chrome.storage.local.get('jobs');
    const jobs = d.jobs ?? {};
    const cached = jobs[jobId];
    if (cached && isFresh(cached.capturedAt, 7) && cached.rawJD && !cached.partial) return cached;
  }

  const jobEl = document.querySelector(cvfx.SELECTORS.candidate.jobInfo);
  const briefJobText = jobEl?.innerText?.trim() || '';

  if (jobId) {
    try {
      const res = await sendMsg(MSG.FETCH_JD, { jobId, origin: location.origin });
      if (res?.jobData) return res.jobData;
    } catch { /* ignore */ }
    const d = await chrome.storage.local.get('jobs');
    if (d.jobs?.[jobId]) return d.jobs[jobId];
  }

  return {
    jobId: jobId || 'unknown',
    jobTitle: briefJobText.split('\n')[0] || '未知职位',
    rawJD: briefJobText || '[未找到 JD，请先访问职位详情页]',
    capturedAt: Date.now(),
  };
}

async function withScoringTimeout(msgPromise, candidateId, settings, timeoutMs = 90000) {
  const result = await Promise.race([
    msgPromise,
    sleep(timeoutMs).then(() => null),
  ]);
  if (result) return result;

  // sendMsg 通道可能已失效（用户离开页面），轮询 storage（background 会 saveScore）
  for (let i = 0; i < 20; i++) {
    const cached = await cvfxGetCachedScore(candidateId, settings);
    if (cached) return { ok: true, result: cached };
    await sleep(3000);
  }
  throw new Error('评分超时：LLM 响应未在预期时间内完成');
}

async function attachRankInfo(result) {
  if (!result || !result.jobId) return result;
  try {
    const data = await chrome.storage.local.get('scores');
    const scores = data.scores ?? {};
    const sameJob = Object.values(scores).filter(
      s => s.jobId === result.jobId && typeof s.overallScore === 'number'
    );
    if (sameJob.length < 3) return result;

    const allScores = sameJob.map(s => s.overallScore);
    const avg = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length);
    const sorted = [...allScores].sort((a, b) => b - a);
    const rank = sorted.indexOf(result.overallScore) + 1;
    const diff = result.overallScore - avg;
    const diffStr = diff >= 0 ? `+${diff}` : `${diff}`;

    return {
      ...result,
      rankInfo: `高于平均 ${diffStr} 分 · 排名 ${rank}/${sameJob.length}`,
    };
  } catch (e) {
    console.warn('[CVFilterX] attachRankInfo 失败:', e.message);
    return result;
  }
}

async function getCurrentTemplateInfo(settings) {
  const cvfx = window.__cvfx;
  try {
    const resumeData = cvfx.extractResumeData(settings.fieldConfig);
    const jobId = resumeData.jobId;

    if (jobId) {
      const jtRes = await sendMsg(MSG.GET_JOB_TEMPLATE, { jobId });
      if (jtRes?.jobTemplate) {
        const tplRes = await sendMsg(MSG.GET_TEMPLATES);
        const tpl = tplRes?.templates?.[jtRes.jobTemplate.templateId];
        if (tpl) return { id: tpl.id, name: tpl.name };
      }
    }

    const jobTitle = document.querySelector(cvfx.SELECTORS.candidate.jobInfo)?.innerText?.split('\n')[0] || '';
    if (jobTitle) {
      const matchRes = await sendMsg(MSG.MATCH_TEMPLATE, { jobTitle });
      if (matchRes?.template) {
        return { id: matchRes.template.id, name: `${matchRes.template.name}（推荐）` };
      }
    }

    const tplRes = await sendMsg(MSG.GET_TEMPLATES);
    if (tplRes?.templates) {
      const tplList = Object.values(tplRes.templates);
      const defaultTpl = tplList.find(t => t.isDefault) || tplList[0];
      if (defaultTpl) return { id: defaultTpl.id, name: defaultTpl.name };
    }
  } catch (e) {
    console.warn('[CVFilterX] 获取模板信息失败:', e.message);
  }
  return null;
}
