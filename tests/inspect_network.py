"""
监听评估列表页的所有 API 请求 + 验证 API 拦截是否工作
"""

import os, json
from playwright.sync_api import sync_playwright

EXTENSION_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
USER_DATA_DIR = os.path.expanduser('~/.cvfilterx-test-profile')
SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), 'screenshots')
EVAL_LIST_URL = 'https://q6y6Bvu0j8.feishu.cn/hire/application-biz/evaluation/list?activeStatus=1&newFilters=%7B%7D&pageTotalLimit=0'

def log(msg):
    print(msg, flush=True)

api_calls = []

def on_request(request):
    url = request.url
    if '/hire/' in url or '/recruitment/' in url or '/evaluation/' in url or 'application' in url:
        api_calls.append({'type': 'request', 'method': request.method, 'url': url})

def on_response(response):
    url = response.url
    if '/hire/' in url or '/recruitment/' in url or '/evaluation/' in url or 'application' in url:
        status = response.status
        if status == 200:
            ct = response.headers.get('content-type', '')
            if 'json' in ct:
                try:
                    body = response.body()
                    data = json.loads(body)
                    api_calls.append({'type': 'json_response', 'url': url, 'size': len(body), 'keys': list(data.keys()) if isinstance(data, dict) else f'array[{len(data)}]'})
                except Exception as e:
                    api_calls.append({'type': 'json_response', 'url': url, 'error': str(e)})

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
    page.on('request', on_request)
    page.on('response', on_response)

    # 监听 console（关注 API 拦截日志）
    console_logs = []
    page.on('console', lambda m: console_logs.append(f'[{m.type}] {m.text}'))

    log('导航到评估列表页...')
    page.goto(EVAL_LIST_URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(3000)

    log('\n===== 捕获的 /hire/ 相关请求 =====')
    hire_apis = [c for c in api_calls if c['type'] == 'json_response']
    for c in hire_apis:
        if 'error' not in c:
            log(f'  {c["url"].replace("https://q6y6Bvu0j8.feishu.cn", "")}')
            log(f'    keys={c["keys"]}, size={c["size"]}')
        else:
            log(f'  {c["url"]} ERROR: {c["error"]}')

    log('\n===== CVFilterX 相关 console 日志 =====')
    for l in console_logs:
        if 'cvfilterx' in l.lower() or 'CVFilterX' in l or 'cvfx' in l.lower():
            log(f'  {l}')

    # 检查 __cvfx._evalList 是否有数据
    eval_list = page.evaluate("""() => {
        if (!window.__cvfx) return {error: '__cvfx not found'};
        return {
            hasEvalList: !!window.__cvfx._evalList,
            count: window.__cvfx._evalList ? window.__cvfx._evalList.length : 0,
            sample: window.__cvfx._evalList ? window.__cvfx._evalList.slice(0, 2) : null
        };
    }""")
    log(f'\n===== __cvfx._evalList 状态 =====')
    log(f'  {json.dumps(eval_list, ensure_ascii=False, indent=2)}')

    # 保存所有 API 调用记录
    out = os.path.join(SCREENSHOTS_DIR, 'network-calls.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(api_calls, f, ensure_ascii=False, indent=2)
    log(f'\n完整网络记录: {out}')

    ctx.close()
