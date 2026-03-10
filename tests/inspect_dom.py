"""
DOM 探查脚本：找出飞书评估列表页的候选人 DOM 结构
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
    page.goto(EVAL_LIST_URL, wait_until='domcontentloaded', timeout=30000)
    page.wait_for_timeout(4000)  # 等待 React 渲染完成

    page.screenshot(path=os.path.join(SCREENSHOTS_DIR, 'dom-inspect.png'))

    # ---- 探查 DOM ----
    result = page.evaluate("""() => {
        const info = {};

        // 1. 基本元素计数
        info.tr = document.querySelectorAll('tr').length;
        info.td = document.querySelectorAll('td').length;
        info.tableRows = document.querySelectorAll('[class*="table-row"], [class*="tableRow"], [class*="TableRow"]').length;
        info.listItems = document.querySelectorAll('[class*="list-item"], [class*="listItem"], [class*="candidate"]').length;

        // 2. data-* 属性探查
        const allEls = document.querySelectorAll('*');
        const dataAttrs = new Set();
        for (const el of allEls) {
            for (const attr of el.attributes) {
                if (attr.name.startsWith('data-')) dataAttrs.add(attr.name);
            }
        }
        info.dataAttributes = Array.from(dataAttrs).sort();

        // 3. 自定义标签名（含 - 的）
        const customTags = new Set();
        for (const el of allEls) {
            const tag = el.tagName.toLowerCase();
            if (tag.includes('-')) customTags.add(tag);
        }
        info.customElements = Array.from(customTags).sort();

        // 4. 找包含候选人姓名的容器（找 a 标签文字像人名的）
        const links = document.querySelectorAll('a');
        const candidateLinks = [];
        for (const a of links) {
            if (a.href && a.href.includes('/hire/talent/')) {
                candidateLinks.push({
                    href: a.href,
                    text: a.textContent.trim().slice(0, 30),
                    classes: a.className.slice(0, 80),
                    dataAttrs: Array.from(a.attributes)
                        .filter(at => at.name.startsWith('data-'))
                        .map(at => `${at.name}=${at.value}`)
                });
            }
        }
        info.talentLinks = candidateLinks.slice(0, 5);

        // 5. 找 iframe
        info.iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
            src: f.src, id: f.id, name: f.name
        }));

        // 6. body 顶层子元素
        info.bodyChildren = Array.from(document.body.children).map(el =>
            `<${el.tagName.toLowerCase()} id="${el.id}" class="${el.className.slice(0,60)}">`
        );

        // 7. 找含候选人内容的容器（搜索第一个候选人姓名）
        const nameEl = document.querySelector('[class*="name"], [class*="Name"]');
        if (nameEl) {
            info.firstNameEl = {
                tag: nameEl.tagName.toLowerCase(),
                class: nameEl.className.slice(0, 100),
                text: nameEl.textContent.trim().slice(0, 30),
                parentTag: nameEl.parentElement?.tagName?.toLowerCase(),
                parentClass: nameEl.parentElement?.className?.slice(0, 100),
            };
        }

        return info;
    }""")

    log('\n===== DOM 探查结果 =====\n')
    log(f'<tr>: {result["tr"]},  <td>: {result["td"]}')
    log(f'table-row 类: {result["tableRows"]},  list-item/candidate 类: {result["listItems"]}')
    log(f'\niframe 数量: {len(result["iframes"])}')
    for f in result['iframes']:
        log(f'  iframe: {f}')

    log(f'\n自定义元素 (含-):')
    for tag in result['customElements']:
        log(f'  {tag}')

    log(f'\ndata-* 属性:')
    for attr in result['dataAttributes']:
        log(f'  {attr}')

    log(f'\n/hire/talent/ 链接:')
    if result['talentLinks']:
        for link in result['talentLinks']:
            log(f'  {link}')
    else:
        log('  (无) — 评估列表可能不用 <a href="/hire/talent/...">')

    if result.get('firstNameEl'):
        log(f'\n第一个 [class*=name] 元素:')
        log(f'  {result["firstNameEl"]}')

    log(f'\nbody 顶层子元素:')
    for c in result['bodyChildren'][:10]:
        log(f'  {c}')

    # 保存完整结果
    out_path = os.path.join(SCREENSHOTS_DIR, 'dom-result.json')
    with open(out_path, 'w') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    log(f'\n完整结果已保存: {out_path}')

    page.screenshot(path=os.path.join(SCREENSHOTS_DIR, 'dom-inspect-final.png'))
    ctx.close()
