"""
验证候选人详情页的 DOM 提取情况
从 list_v2 响应里拿第一个候选人的 talent_id/application_id/job_id，
然后导航到详情页检查 extractResumeData 能拿到什么。
"""

import os, json
from playwright.sync_api import sync_playwright

EXTENSION_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
USER_DATA_DIR = os.path.expanduser('~/.cvfilterx-test-profile')
SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), 'screenshots')
EVAL_LIST_URL = 'https://q6y6Bvu0j8.feishu.cn/hire/application-biz/evaluation/list?activeStatus=1&newFilters=%7B%7D&pageTotalLimit=0'

def log(msg):
    print(msg, flush=True)

# 从上次保存的响应文件读取第一个候选人
resp_path = os.path.join(SCREENSHOTS_DIR, 'list_v2_response.json')
with open(resp_path) as f:
    resp = json.load(f)

first = resp['data']['evaluation_list'][0]
talent_id    = first['talent_id']
app_id       = first['application_id']
job_id       = first['job_id']
origin       = 'https://q6y6Bvu0j8.feishu.cn'
talent_url   = f'{origin}/hire/talent/{talent_id}?application_id={app_id}&job_id={job_id}'

log(f'候选人 URL: {talent_url}')

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

    page.screenshot(path=os.path.join(SCREENSHOTS_DIR, 'talent-loaded.png'))

    # ── 检查各个选择器 ──
    checks = page.evaluate("""() => {
        const SELECTORS = {
            talentEl:           '[data-talent-id]',
            basicInfoSummary:   '[class*="basicInfoSummary"]',
            contactInfo:        '[class*="contactInfoContainer"]',
            careerContainer:    '[class*="careerListContainer"]',
            educationContainer: '[class*="educationListContainer"]',
            jobInfo:            '[class*="jobInfo__"]',
        };
        const result = {};
        for (const [key, sel] of Object.entries(SELECTORS)) {
            const el = document.querySelector(sel);
            result[key] = {
                found: !!el,
                tag: el ? el.tagName.toLowerCase() : null,
                text: el ? el.innerText.trim().slice(0, 100) : null,
                dataAttrs: el ? Array.from(el.attributes)
                    .filter(a => a.name.startsWith('data-'))
                    .map(a => a.name + '=' + a.value.slice(0,30)) : [],
            };
        }
        return result;
    }""")

    log('\n===== 选择器命中情况 =====')
    for key, val in checks.items():
        status = '✅' if val['found'] else '❌'
        log(f'{status} {key}: {val["text"][:80] if val["text"] else "(not found)"}')
        if val['found'] and val['dataAttrs']:
            log(f'   data attrs: {val["dataAttrs"]}')

    # ── 叶节点文本（找简历内容）──
    texts = page.evaluate("""() => {
        const result = [];
        document.querySelectorAll('*').forEach(el => {
            if (el.children.length === 0) {
                const t = el.textContent.trim();
                if (t.length > 5 && t.length < 200) {
                    result.push({
                        text: t.slice(0, 120),
                        tag: el.tagName.toLowerCase(),
                        cls: (el.className || '').toString().slice(0, 80),
                    });
                }
            }
        });
        return result.slice(0, 40);
    }""")

    log('\n===== 页面叶节点文本（前40）=====')
    for t in texts:
        log(f'  <{t["tag"]}> {t["cls"][:50]}')
        log(f'    "{t["text"]}"')

    # ── canvas 情况 ──
    canvas_count = page.evaluate("() => document.querySelectorAll('canvas').length")
    log(f'\nCanvas 数量: {canvas_count}')

    # ── CVFilterX 日志 ──
    log('\n===== CVFilterX console 日志 =====')
    for l in console_logs:
        if 'cvfilterx' in l.lower() or 'CVFilterX' in l:
            log(f'  {l}')

    # ── data-* 属性全集 ──
    data_attrs = page.evaluate("""() => {
        const attrs = new Set();
        document.querySelectorAll('*').forEach(el => {
            for (const a of el.attributes) {
                if (a.name.startsWith('data-')) attrs.add(a.name);
            }
        });
        return Array.from(attrs).sort();
    }""")
    log(f'\ndata-* 属性全集: {data_attrs}')

    ctx.close()
