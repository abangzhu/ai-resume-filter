"""
深度探查 #main-app 内部结构 + 等待 networkidle
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

    page.screenshot(path=os.path.join(SCREENSHOTS_DIR, 'dom2-loaded.png'))

    result = page.evaluate("""() => {
        const info = {};

        // 1. 所有元素数量
        info.totalElements = document.querySelectorAll('*').length;

        // 2. 尝试找候选人姓名文字（已知姓名：张博栋、张永嘉 等）
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) {
            const t = node.textContent.trim();
            if (t.length >= 2 && t.length <= 10 && /^[\u4e00-\u9fa5]+$/.test(t)) {
                const el = node.parentElement;
                textNodes.push({
                    text: t,
                    tag: el?.tagName?.toLowerCase(),
                    class: el?.className?.toString().slice(0, 80),
                    dataAttrs: Array.from(el?.attributes || [])
                        .filter(a => a.name.startsWith('data-'))
                        .map(a => `${a.name}=${a.value}`)
                        .slice(0, 5)
                });
            }
        }
        info.chineseNameCandidates = textNodes.slice(0, 20);

        // 3. canvas 元素
        info.canvases = document.querySelectorAll('canvas').length;

        // 4. 深度展开 #main-app 前3层结构
        function getStructure(el, depth) {
            if (depth > 3) return '...';
            const tag = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : '';
            const cls = el.className && typeof el.className === 'string'
                ? `.${el.className.split(' ').filter(Boolean).slice(0,3).join('.')}`
                : '';
            const dataStr = Array.from(el.attributes)
                .filter(a => a.name.startsWith('data-'))
                .map(a => `[${a.name}=${a.value.slice(0,20)}]`)
                .slice(0, 3).join('');
            let str = `${tag}${id}${cls}${dataStr}`;
            const children = Array.from(el.children).slice(0, 5);
            if (children.length > 0) {
                str += ' { ' + children.map(c => getStructure(c, depth + 1)).join(', ') + ' }';
            }
            return str;
        }
        const mainApp = document.querySelector('#main-app');
        info.mainAppStructure = mainApp ? getStructure(mainApp, 0) : 'NOT FOUND';

        // 5. 查找所有 data-cy 属性（飞书常用于测试选择器）
        const dataCyEls = document.querySelectorAll('[data-cy]');
        info.dataCyValues = Array.from(dataCyEls).map(el => ({
            cy: el.getAttribute('data-cy'),
            tag: el.tagName.toLowerCase(),
            class: el.className?.toString().slice(0, 60),
            children: el.children.length
        })).slice(0, 30);

        // 6. 查找 role 属性
        const roleEls = document.querySelectorAll('[role]');
        info.roles = Array.from(new Set(Array.from(roleEls).map(el => el.getAttribute('role')))).sort();

        // 7. shadow root
        const shadowHosts = [];
        document.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) shadowHosts.push(el.tagName.toLowerCase());
        });
        info.shadowHosts = shadowHosts;

        return info;
    }""")

    log('\n===== 深度 DOM 探查 =====\n')
    log(f'总元素数: {result["totalElements"]}')
    log(f'canvas 数: {result["canvases"]}')
    log(f'shadow host 数: {len(result["shadowHosts"])} — {result["shadowHosts"][:10]}')

    log(f'\n#main-app 结构 (前3层):')
    # 截断长字符串
    structure = result['mainAppStructure']
    if len(structure) > 1000:
        structure = structure[:1000] + '...[截断]'
    log(structure)

    log(f'\ndata-cy 元素:')
    for el in result['dataCyValues']:
        log(f'  [{el["cy"]}] <{el["tag"]}> class={el["class"][:50]}')

    log(f'\nrole 属性值: {result["roles"]}')

    log(f'\n中文名字文本节点 (前20):')
    for t in result['chineseNameCandidates']:
        log(f'  "{t["text"]}" in <{t["tag"]}> class={t["class"][:60]} {t["dataAttrs"]}')

    out = os.path.join(SCREENSHOTS_DIR, 'dom2-result.json')
    with open(out, 'w') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    log(f'\n完整结果: {out}')

    ctx.close()
