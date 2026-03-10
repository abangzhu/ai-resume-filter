"""
CVFilterX Chrome Extension Playwright Test
- 以非 headless 模式启动 Chromium 并加载扩展
- 持久化用户数据目录（保留登录态）
- 截图验证各页面状态
"""

import os
import sys
import time
from playwright.sync_api import sync_playwright

EXTENSION_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
USER_DATA_DIR = os.path.expanduser('~/.cvfilterx-test-profile')
SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), 'screenshots')

os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

# 从上次测试截图拿到的 URL
EVAL_LIST_URL = 'https://q6y6Bvu0j8.feishu.cn/hire/application-biz/evaluation/list?activeStatus=1&newFilters=%7B%7D&pageTotalLimit=0'


def log(msg):
    print(f'[TEST] {msg}', flush=True)


def capture(page, name):
    path = os.path.join(SCREENSHOTS_DIR, f'{name}.png')
    page.screenshot(path=path, full_page=False)
    log(f'截图已保存: {path}')
    return path


def collect_console(page):
    logs = []
    page.on('console', lambda msg: logs.append(f'[{msg.type}] {msg.text}'))
    return logs


def test_evaluation_list(context):
    """测试简历评估列表页：验证 content script 注入、候选人提取"""
    log('=== 测试：简历评估列表页 ===')
    page = context.new_page()
    console_logs = collect_console(page)

    log(f'导航到: {EVAL_LIST_URL}')
    page.goto(EVAL_LIST_URL, wait_until='domcontentloaded', timeout=30000)
    page.wait_for_timeout(3000)

    capture(page, '01-eval-list-loaded')

    # 检查是否需要登录
    if 'login' in page.url or 'passport' in page.url or 'accounts.feishu' in page.url:
        log('⚠ 未登录 — 请在打开的浏览器窗口中扫码登录，最多等待 120 秒...')
        try:
            page.wait_for_url(
                lambda url: 'login' not in url and 'passport' not in url and 'accounts' not in url,
                timeout=120000
            )
        except Exception:
            log('✗ 等待登录超时，请重新运行脚本')
            page.close()
            return {'talent_links': 0, 'name_cards': 0}
        page.wait_for_load_state('networkidle', timeout=30000)
        capture(page, '02-after-login')
        log('✓ 登录成功')

    # 等待页面稳定
    page.wait_for_timeout(2000)
    capture(page, '03-eval-list-stable')

    # 验证 content script 是否注入成功（通过 window.__cvfilterx__ 标志）
    injected = page.evaluate("() => !!window.__cvfilterx_injected__")
    log(f'Content script 注入: {"✓" if injected else "✗ (可能正常，取决于实现)"}')

    # 提取候选人行数量
    candidate_rows = page.locator('tr').count()
    log(f'页面 <tr> 行数: {candidate_rows}')

    # 尝试 data-talent-id 策略（MEMORY 中记录的最佳策略）
    talent_links = page.locator('[data-talent-id]').count()
    log(f'[data-talent-id] 元素数: {talent_links}')

    # 检查 ee-name-enhance-card 组件
    name_cards = page.locator('ee-name-enhance-card').count()
    log(f'ee-name-enhance-card 组件数: {name_cards}')

    # 打印 content script console 输出
    cvfx_logs = [l for l in console_logs if 'cvfilterx' in l.lower() or 'CVFilterX' in l]
    if cvfx_logs:
        log('Content script 日志:')
        for l in cvfx_logs[:20]:
            print(f'  {l}')
    else:
        log('未找到 CVFilterX 相关 console 输出')

    page.close()
    return {'talent_links': talent_links, 'name_cards': name_cards}


def test_popup_ui(context, extension_id):
    """测试 popup 界面"""
    log('=== 测试：Popup UI ===')
    popup_url = f'chrome-extension://{extension_id}/popup/popup.html'
    log(f'打开 popup: {popup_url}')

    page = context.new_page()
    page.goto(popup_url)
    page.wait_for_load_state('load')
    page.wait_for_timeout(500)

    capture(page, '04-popup-ui')

    # 验证关键 UI 元素
    checks = {
        '#startBtn': 'start 按钮',
        '#stopBtn': 'stop 按钮',
        '#scoreStats': '分数统计区',
        '#jdStatus': 'JD 状态',
    }
    for selector, label in checks.items():
        exists = page.locator(selector).count() > 0
        log(f'  {label} ({selector}): {"✓" if exists else "✗"}')

    page.close()


def get_extension_id(context):
    """从 chrome://extensions 获取已加载扩展的 ID"""
    page = context.new_page()
    page.goto('chrome://extensions/')
    page.wait_for_timeout(1000)

    # extensions 页面用 shadow DOM，需要 evaluate
    ext_id = page.evaluate("""() => {
        const mgr = document.querySelector('extensions-manager');
        if (!mgr) return null;
        const root = mgr.shadowRoot;
        if (!root) return null;
        const items = root.querySelectorAll('extensions-item');
        for (const item of items) {
            const nameEl = item.shadowRoot && item.shadowRoot.querySelector('#name');
            if (nameEl && nameEl.textContent.includes('CVFilterX')) {
                return item.getAttribute('id');
            }
        }
        return null;
    }""")
    page.close()
    return ext_id


def main():
    log(f'扩展路径: {EXTENSION_PATH}')
    log(f'用户数据目录: {USER_DATA_DIR}')
    log(f'截图保存到: {SCREENSHOTS_DIR}')

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            USER_DATA_DIR,
            headless=False,
            args=[
                f'--disable-extensions-except={EXTENSION_PATH}',
                f'--load-extension={EXTENSION_PATH}',
                '--no-first-run',
                '--no-default-browser-check',
            ],
            viewport={'width': 1440, 'height': 900},
        )

        log('浏览器已启动，正在获取扩展 ID...')
        ext_id = get_extension_id(context)
        if ext_id:
            log(f'扩展 ID: {ext_id}')
        else:
            log('⚠ 未能自动获取扩展 ID（shadow DOM 限制），跳过 popup 测试')

        # 主测试
        result = test_evaluation_list(context)

        # Popup 测试（需要扩展 ID）
        if ext_id:
            test_popup_ui(context, ext_id)

        # 汇总
        log('')
        log('=== 测试结果汇总 ===')
        log(f'  候选人 data-talent-id 元素: {result["talent_links"]}')
        log(f'  ee-name-enhance-card 组件: {result["name_cards"]}')
        log(f'  截图目录: {SCREENSHOTS_DIR}')

        log('')
        log('测试完成。浏览器将保持打开 10 秒后关闭。')
        time.sleep(10)
        context.close()


if __name__ == '__main__':
    main()
