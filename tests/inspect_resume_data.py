"""
检查 extractResumeData() 实际提取到的内容（完整版，不截断）
"""

import os, json
from playwright.sync_api import sync_playwright

EXTENSION_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
USER_DATA_DIR = os.path.expanduser('~/.cvfilterx-test-profile')
SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), 'screenshots')

resp_path = os.path.join(SCREENSHOTS_DIR, 'list_v2_response.json')
with open(resp_path) as f:
    resp = json.load(f)

first = resp['data']['evaluation_list'][0]
origin   = 'https://q6y6Bvu0j8.feishu.cn'
talent_url = f'{origin}/hire/talent/{first["talent_id"]}?application_id={first["application_id"]}&job_id={first["job_id"]}'

def log(msg):
    print(msg, flush=True)

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        USER_DATA_DIR,
        headless=False,
        args=[
            f'--disable-extensions-except={EXTENSION_PATH}',
            f'--load-extension={EXTENSION_PATH}',
            '--no-first-run',
        ],
        viewport={'width': 1440, 'height': 900},
    )

    page = ctx.new_page()
    console_logs = []
    page.on('console', lambda m: console_logs.append(f'[{m.type}] {m.text}'))

    page.goto(talent_url, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(4000)
    page.screenshot(path=os.path.join(SCREENSHOTS_DIR, 'talent-detail.png'))

    # 直接模拟 extractResumeData() 逻辑，检查每个字段的完整内容
    extracted = page.evaluate("""() => {
        const SELECTORS = {
            talentEl:           '[data-talent-id]',
            basicInfoSummary:   '[class*="basicInfoSummary"]',
            contactInfo:        '[class*="contactInfoContainer"]',
            careerContainer:    '[class*="careerListContainer"]',
            educationContainer: '[class*="educationListContainer"]',
            jobInfo:            '[class*="jobInfo__"]',
        };

        const get = sel => document.querySelector(sel);

        const talentEl = get(SELECTORS.talentEl);
        const result = {
            candidateId:   talentEl?.getAttribute('data-talent-id') || location.pathname.split('/').pop(),
            candidateName: talentEl?.getAttribute('data-name') || talentEl?.innerText?.trim() || '',
            jobId:         new URLSearchParams(location.search).get('job_id') || '',
            applicationId: new URLSearchParams(location.search).get('application_id') || '',
        };

        const fields = {
            basicInfoText:  SELECTORS.basicInfoSummary,
            contactText:    SELECTORS.contactInfo,
            careerText:     SELECTORS.careerContainer,
            educationText:  SELECTORS.educationContainer,
            appliedJobInfo: SELECTORS.jobInfo,
        };

        for (const [key, sel] of Object.entries(fields)) {
            const el = get(sel);
            result[key] = el ? el.innerText.trim() : null;
        }

        return result;
    }""")

    log('\n===== extractResumeData() 模拟结果 =====\n')
    for key, val in extracted.items():
        if val is None:
            log(f'❌ {key}: null')
        elif val == '':
            log(f'⚠ {key}: (空字符串)')
        else:
            preview = val.replace('\n', '↵')[:200]
            log(f'✅ {key} ({len(val)} chars): {preview}')

    # 检查浮层是否挂载
    overlay = page.evaluate("""() => {
        const el = document.getElementById('cvfx-overlay');
        return el ? {found: true, html: el.outerHTML.slice(0, 300)} : {found: false};
    }""")
    log(f'\n===== CVFilterX 浮层 =====')
    log(f'{"已挂载" if overlay["found"] else "❌ 未挂载"}')
    if overlay['found']:
        log(overlay['html'])

    # CVFilterX 日志
    log('\n===== CVFilterX console 日志 =====')
    for l in console_logs:
        if 'cvfilterx' in l.lower() or 'CVFilterX' in l:
            log(f'  {l}')

    ctx.close()
