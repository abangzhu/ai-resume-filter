"""
捕获 list_v2 请求的 method / headers / body
"""

import os, json
from playwright.sync_api import sync_playwright

EXTENSION_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
USER_DATA_DIR = os.path.expanduser('~/.cvfilterx-test-profile')
SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), 'screenshots')
EVAL_LIST_URL = 'https://q6y6Bvu0j8.feishu.cn/hire/application-biz/evaluation/list?activeStatus=1&newFilters=%7B%7D&pageTotalLimit=0'

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

    captured_req = {}

    def on_request(req):
        if 'evaluation/list_v2' in req.url:
            body = None
            try:
                body = req.post_data
            except Exception:
                pass
            captured_req['method'] = req.method
            captured_req['url'] = req.url
            captured_req['headers'] = dict(req.headers)
            captured_req['body'] = body

    page.on('request', on_request)
    page.goto(EVAL_LIST_URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(2000)

    if captured_req:
        log(f'Method: {captured_req["method"]}')
        log(f'URL: {captured_req["url"]}')
        log(f'\nRequest Body:')
        body = captured_req.get('body')
        if body:
            try:
                log(json.dumps(json.loads(body), ensure_ascii=False, indent=2))
            except Exception:
                log(body)
        else:
            log('(no body / GET)')

        log(f'\nKey Headers:')
        headers = captured_req.get('headers', {})
        interesting = ['content-type', 'x-csrftoken', 'x-tt-logid', 'biz_context',
                       'x-request-id', 'cookie', 'referer', 'x-sagittarius-csrf']
        for k in interesting:
            if k in headers:
                v = headers[k]
                log(f'  {k}: {v[:80] if len(v) > 80 else v}')
    else:
        log('未捕获到 list_v2 请求')

    ctx.close()
