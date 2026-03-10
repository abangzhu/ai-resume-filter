"""
捕获 /evaluation/list_v2/ 的真实响应结构
"""

import os, json
from playwright.sync_api import sync_playwright

EXTENSION_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
USER_DATA_DIR = os.path.expanduser('~/.cvfilterx-test-profile')
SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), 'screenshots')
EVAL_LIST_URL = 'https://q6y6Bvu0j8.feishu.cn/hire/application-biz/evaluation/list?activeStatus=1&newFilters=%7B%7D&pageTotalLimit=0'

def log(msg):
    print(msg, flush=True)

captured = {}

def on_response(response):
    url = response.url
    if 'evaluation/list_v2' in url:
        try:
            body = response.body()
            captured['list_v2'] = {'url': url, 'body': json.loads(body)}
        except Exception as e:
            captured['list_v2_err'] = str(e)

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
    page.on('response', on_response)
    page.goto(EVAL_LIST_URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(2000)

    if 'list_v2' in captured:
        data = captured['list_v2']['body']
        log(f'URL: {captured["list_v2"]["url"]}')
        log(f'\n顶层字段: {list(data.keys())}')

        # 展开 data 字段结构
        if 'data' in data:
            d = data['data']
            log(f'\ndata 字段: {list(d.keys()) if isinstance(d, dict) else type(d).__name__}')

            if isinstance(d, dict):
                for k, v in d.items():
                    if isinstance(v, list) and len(v) > 0:
                        log(f'\ndata.{k} (list, 共 {len(v)} 条):')
                        # 展示第一条的字段
                        first = v[0]
                        if isinstance(first, dict):
                            log(f'  第一条字段: {list(first.keys())}')
                            # 找 talent_id / application_id / job_id
                            for key in ['talent_id', 'application_id', 'job_id', 'name', 'id']:
                                if key in first:
                                    log(f'  {key}: {first[key]}')
                    elif not isinstance(v, (list, dict)):
                        log(f'data.{k}: {v}')

        # 保存完整响应
        out = os.path.join(SCREENSHOTS_DIR, 'list_v2_response.json')
        with open(out, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        log(f'\n完整响应已保存: {out}')
    else:
        log('未捕获到 list_v2 响应')
        log(captured)

    ctx.close()
