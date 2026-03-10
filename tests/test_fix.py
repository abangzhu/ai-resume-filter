"""
验证 fetchEvalListDirect 修复后候选人数量正确
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
    console_logs = []
    page.on('console', lambda m: console_logs.append(f'[{m.type}] {m.text}'))

    log('导航到评估列表页...')
    page.goto(EVAL_LIST_URL, wait_until='networkidle', timeout=30000)

    # 等待足够时间让 waitForEvalList 完成（1.5s 拦截 + API 调用时间）
    log('等待 content script 处理完毕 (5s)...')
    page.wait_for_timeout(5000)

    page.screenshot(path=os.path.join(SCREENSHOTS_DIR, 'fix-result.png'))

    # 检查 CVFilterX console 日志
    log('\n===== CVFilterX console 日志 =====')
    for l in console_logs:
        if 'cvfilterx' in l.lower() or 'CVFilterX' in l or 'cvfx' in l.lower():
            log(f'  {l}')

    # 检查 window.__cvfx._evalList（content script isolated world，无法直接访问）
    # 但可以验证 GET_CANDIDATE_COUNT 消息响应（通过 popup 测试）
    # 改为检查 console 里的 "评估列表候选人数" 日志
    count_logs = [l for l in console_logs if '候选人数' in l or '直接调用' in l or 'API 数据已捕获' in l]
    log('\n===== 候选人数相关日志 =====')
    for l in count_logs:
        log(f'  {l}')

    if any('直接调用成功' in l for l in console_logs):
        log('\n✅ fetchEvalListDirect 成功！')
    elif any('API 数据已捕获' in l for l in console_logs):
        log('\n✅ 拦截器方式成功！')
    else:
        log('\n❌ 未找到成功标志，请检查日志')

    ctx.close()
