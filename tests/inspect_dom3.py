"""
导出完整 HTML + 探查 faster-main 结构
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
    page.goto(EVAL_LIST_URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(3000)

    # 保存完整 HTML
    html = page.content()
    html_path = os.path.join(SCREENSHOTS_DIR, 'page.html')
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html)
    log(f'HTML 已保存 ({len(html)} bytes): {html_path}')

    # 逐步探查
    faster = page.evaluate("() => { const el = document.querySelector('[role=\"faster-main\"]'); return el ? el.outerHTML.slice(0, 2000) : 'NOT FOUND'; }")
    log(f'\nfaster-main outerHTML (前2000字符):\n{faster}')

    links = page.evaluate("() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(h => h.includes('/hire'))")
    log(f'\n/hire 相关链接: {links[:20]}')

    canvas_info = page.evaluate("""() => {
        const canvases = document.querySelectorAll('canvas');
        return Array.from(canvases).map(function(c) {
            return {
                width: c.width,
                height: c.height,
                id: c.id,
                class: c.className
            };
        });
    }""")
    log(f'\nCanvas 列表:')
    for c in canvas_info:
        log(f'  {c}')

    # 找所有文本内容包含候选人姓名关键字的元素
    text_search = page.evaluate("""() => {
        var results = [];
        var els = document.querySelectorAll('*');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (el.children.length === 0) {
                var t = el.textContent.trim();
                if (t.length > 0 && t.length < 20) {
                    results.push({
                        text: t,
                        tag: el.tagName.toLowerCase(),
                        cls: el.className ? el.className.toString().slice(0, 80) : ''
                    });
                }
            }
        }
        return results.slice(0, 50);
    }""")
    log(f'\n叶节点文本 (前50):')
    for t in text_search:
        log(f'  "{t["text"]}" <{t["tag"]}> {t["cls"][:50]}')

    ctx.close()
