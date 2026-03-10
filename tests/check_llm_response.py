"""
从 Service Worker DevTools 日志确认 LLM 返回的 dimensions 结构
直接读取 chrome.storage 里最新一条评分记录
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

def log(msg): print(msg, flush=True)

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        USER_DATA_DIR, headless=False,
        args=[f'--disable-extensions-except={EXTENSION_PATH}',
              f'--load-extension={EXTENSION_PATH}', '--no-first-run'],
        viewport={'width': 1440, 'height': 900},
    )
    page = ctx.new_page()
    page.goto(talent_url, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(3000)

    # 读 chrome.storage 里已缓存的评分（content script 世界）
    scores = page.evaluate("""() => new Promise(resolve => {
        chrome.storage.local.get('scores', d => resolve(d.scores ?? {}));
    })""")

    if scores:
        log('===== 已缓存评分记录 =====')
        for cid, s in scores.items():
            log(f'\ncandidateId: {cid}')
            log(f'overallScore: {s.get("overallScore")}')
            log(f'recommendation: {s.get("recommendation")}')
            log(f'dimensions keys: {list(s.get("dimensions", {}).keys())}')
            log(f'dimensions: {json.dumps(s.get("dimensions", {}), ensure_ascii=False, indent=2)}')
            log(f'summary: {s.get("summary", "")}')
            log(f'highlights: {s.get("highlights", [])}')
            log(f'concerns: {s.get("concerns", [])}')
    else:
        log('没有缓存的评分记录，请先触发一次评分')

    ctx.close()
