"""
获取 [class*="talentDetail"] 的完整文本，确认是否包含足够简历内容
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
    page.goto(talent_url, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(4000)

    result = page.evaluate("""() => {
        // 找所有匹配 [class*="talentDetail"] 的元素
        const els = document.querySelectorAll('[class*="talentDetail"]');
        const items = Array.from(els).map(el => ({
            tag: el.tagName.toLowerCase(),
            id: el.id,
            cls: el.className.toString().slice(0, 120),
            textLen: (el.innerText || '').length,
            fullText: el.innerText || '',
        }));
        items.sort((a, b) => b.textLen - a.textLen);

        // 也找 #talentDetail 的直接内容结构
        const talentDetailEl = document.querySelector('#talentDetail');
        let splitStructure = null;
        if (talentDetailEl) {
            const split = talentDetailEl.querySelector('[class*="splitFlex"]') ||
                          talentDetailEl.querySelector('[class*="split"]');
            if (split) {
                splitStructure = Array.from(split.children).map(child => ({
                    cls: child.className.toString().slice(0, 80),
                    textLen: (child.innerText || '').length,
                    text: (child.innerText || '').slice(0, 200),
                }));
            }
        }

        // 找含"负责"或"工作内容"的具体段落
        const jobDescParagraphs = [];
        document.querySelectorAll('div, p, li').forEach(el => {
            if (el.children.length === 0 || el.children.length <= 3) {
                const t = (el.innerText || '').trim();
                if ((t.includes('负责') || t.includes('工作内容') || t.includes('主要职责')) && t.length > 30) {
                    jobDescParagraphs.push({
                        cls: el.className.toString().slice(0, 80),
                        text: t.slice(0, 300),
                    });
                }
            }
        });

        return { items: items.slice(0, 5), splitStructure, jobDescParagraphs: jobDescParagraphs.slice(0, 5) };
    }""")

    log('\n===== [class*="talentDetail"] 所有匹配元素 =====')
    for item in result['items']:
        log(f'\n  <{item["tag"]}> id={item["id"]} cls={item["cls"][:80]}')
        log(f'  文本长度: {item["textLen"]} chars')
        log(f'  完整文本:\n{item["fullText"][:800]}')
        log('  ---')

    if result.get('splitStructure'):
        log('\n===== #talentDetail split 子元素 =====')
        for c in result['splitStructure']:
            log(f'  cls={c["cls"][:60]} (len={c["textLen"]})')
            log(f'  "{c["text"][:150].replace(chr(10), "↵")}"')

    if result.get('jobDescParagraphs'):
        log('\n===== 含"负责"的段落 =====')
        for p in result['jobDescParagraphs']:
            log(f'  cls={p["cls"][:60]}')
            log(f'  "{p["text"][:300].replace(chr(10), "↵")}"')

    ctx.close()
