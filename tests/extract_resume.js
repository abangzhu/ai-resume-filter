(() => {
  const SELECTORS = {
    talentEl: '[data-talent-id]',
    resumeTabContent: '[class*="talentDetailTabList"]',
    contactInfo: '[class*="contactInfoContainer"]',
    careerContainer: '[class*="careerListContainer"]',
    educationContainer: '[class*="educationListContainer"]',
    jobInfo: '[class*="jobInfo__"]',
  };

  const talentEl = document.querySelector(SELECTORS.talentEl);
  const result = {
    candidateId: talentEl ? talentEl.getAttribute('data-talent-id') : '',
    candidateName: talentEl ? (talentEl.getAttribute('data-name') || '') : '',
    jobId: new URLSearchParams(location.search).get('job_id') || '',
    applicationId: new URLSearchParams(location.search).get('application_id') || '',
  };

  const resumeTabEl = document.querySelector(SELECTORS.resumeTabContent);
  if (resumeTabEl) {
    const raw = resumeTabEl.innerText.trim();
    const lines = raw.split('\n');
    const noiseWords = ['Resume files (1)', 'Details', 'Additional Information', 'More'];
    let startIdx = 0;
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      const l = lines[i].trim();
      const isNoise = l === '' || noiseWords.indexOf(l) >= 0 || l.indexOf('Resume files') === 0;
      if (isNoise) { startIdx = i + 1; } else { break; }
    }
    result.resumeText = lines.slice(startIdx).join('\n').trim();
  } else {
    result.resumeText = null;
  }

  const contactEl = document.querySelector(SELECTORS.contactInfo);
  result.contactText = contactEl ? contactEl.innerText.trim() : null;

  const careerEl = document.querySelector(SELECTORS.careerContainer);
  result.careerSummary = careerEl ? careerEl.innerText.trim() : null;

  const eduEl = document.querySelector(SELECTORS.educationContainer);
  result.educationSummary = eduEl ? eduEl.innerText.trim() : null;

  const jobEl = document.querySelector(SELECTORS.jobInfo);
  result.appliedJobInfo = jobEl ? jobEl.innerText.trim() : null;

  return result;
})()
