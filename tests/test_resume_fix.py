"""
验证修复后的 extractResumeData() 能拿到完整简历内容
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
origin = 'https://q6y6Bvu0j8.feishu.cn'
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

    # 从外部 JS 文件读取，避免 Playwright 字符串转义问题
    js_path = os.path.join(os.path.dirname(__file__), 'extract_resume.js')
    with open(js_path) as f:
        js_code = f.read()
    extracted = page.evaluate(js_code)

    log('\n===== 更新后 extractResumeData() 结果 =====\n')
    for key, val in extracted.items():
        if val is None:
            log(f'❌ {key}: null')
        elif val == '':
            log(f'⚠ {key}: (空)')
        else:
            log(f'✅ {key} ({len(val)} chars)')
            if key == 'resumeText':
                log(f'\n--- resumeText 完整内容 ---')
                log(val[:1500])
                log('--- end ---\n')

    # 判断
    resume_text = extracted.get('resumeText', '')
    log('\n===== 诊断 =====')
    if len(resume_text) > 200:
        log(f'✅ resumeText 充足 ({len(resume_text)} chars) — 足够 LLM 评分')
    elif len(resume_text) > 0:
        log(f'⚠ resumeText 较短 ({len(resume_text)} chars) — 可能只有 Tab 头')
    else:
        log('❌ resumeText 为空 — talentDetailTabList 选择器未命中')

    page.screenshot(path=os.path.join(SCREENSHOTS_DIR, 'resume-fix-result.png'))
    ctx.close()
