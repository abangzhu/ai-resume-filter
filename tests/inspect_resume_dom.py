"""
找到包含完整简历内容的 DOM 选择器
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
        const info = {};

        // 1. 找所有 innerText 超过 200 chars 的容器（可能是简历主体）
        const bigContainers = [];
        document.querySelectorAll('div, section, article').forEach(el => {
            // 只看直接内容多但子元素不太多的容器（避免整个 body）
            const t = el.innerText || '';
            if (t.length > 200 && t.length < 5000 && el.children.length < 30) {
                bigContainers.push({
                    tag: el.tagName.toLowerCase(),
                    id: el.id,
                    cls: el.className.toString().slice(0, 100),
                    textLen: t.length,
                    text: t.slice(0, 300),
                });
            }
        });
        // 按 textLen 排序
        bigContainers.sort((a, b) => b.textLen - a.textLen);
        info.bigContainers = bigContainers.slice(0, 15);

        // 2. 找 careerListContainer 的父级和子级结构
        const career = document.querySelector('[class*="careerListContainer"]');
        if (career) {
            info.careerParent = {
                tag: career.parentElement?.tagName?.toLowerCase(),
                cls: career.parentElement?.className?.toString().slice(0, 100),
                textLen: (career.parentElement?.innerText || '').length,
            };
            // 所有直接子元素
            info.careerChildren = Array.from(career.children).map(c => ({
                tag: c.tagName.toLowerCase(),
                cls: c.className.toString().slice(0, 80),
                textLen: (c.innerText || '').length,
                text: (c.innerText || '').slice(0, 150),
            }));
            info.careerFullText = career.innerText;
        }

        // 3. 找包含职位描述关键词的元素
        const keywords = ['人工智能', '深度学习', 'python', 'java', '负责', '工作内容', '项目经验'];
        const keywordHits = [];
        document.querySelectorAll('div, p, span, li').forEach(el => {
            const t = el.innerText?.trim() || '';
            if (keywords.some(k => t.toLowerCase().includes(k)) && t.length > 20) {
                keywordHits.push({
                    tag: el.tagName.toLowerCase(),
                    cls: el.className.toString().slice(0, 80),
                    text: t.slice(0, 200),
                });
            }
        });
        info.keywordHits = keywordHits.slice(0, 10);

        // 4. 找 talentDetail / resume 相关容器
        const resumeSelectors = [
            '#talentDetail',
            '[class*="talentDetail"]',
            '[class*="resumeDetail"]',
            '[class*="resume-detail"]',
            '[class*="resumeContent"]',
            '[class*="talentResume"]',
            '[class*="attachResume"]',
            '[class*="standardResume"]',
            '[class*="resumeWrapper"]',
            '[class*="resumeText"]',
            '[class*="resumeSection"]',
            '[class*="careerHistory"]',
            '[class*="workExperience"]',
        ];
        info.resumeSelectors = {};
        for (const sel of resumeSelectors) {
            const el = document.querySelector(sel);
            if (el) {
                info.resumeSelectors[sel] = {
                    found: true,
                    textLen: (el.innerText || '').length,
                    text: (el.innerText || '').slice(0, 300),
                };
            }
        }

        // 5. 找 Tab / 面板结构（可能需要切换到"简历"Tab）
        const tabs = document.querySelectorAll('[role="tab"], [class*="tab"]');
        info.tabs = Array.from(tabs).map(t => ({
            role: t.getAttribute('role'),
            cls: t.className.toString().slice(0, 60),
            text: t.innerText?.trim().slice(0, 30),
            active: t.getAttribute('aria-selected') || t.className.includes('active'),
        })).filter(t => t.text).slice(0, 20);

        return info;
    }""")

    log('\n===== 最大文本容器（按长度排序）=====')
    for c in result.get('bigContainers', []):
        log(f'\n  {c["tag"]}#{c["id"]} .{c["cls"][:60]} (len={c["textLen"]})')
        log(f'  "{c["text"][:200].replace(chr(10), "↵")}"')

    log('\n===== careerListContainer 完整文本 =====')
    career_text = result.get('careerFullText', '')
    log(f'长度: {len(career_text)} chars')
    log(career_text[:500])

    log('\n===== careerListContainer 子元素 =====')
    for c in result.get('careerChildren', []):
        log(f'  <{c["tag"]}> .{c["cls"][:60]} (len={c["textLen"]})')
        log(f'  "{c["text"][:150].replace(chr(10), "↵")}"')

    log('\n===== 关键词命中元素 =====')
    for h in result.get('keywordHits', []):
        log(f'\n  <{h["tag"]}> .{h["cls"][:60]}')
        log(f'  "{h["text"][:200].replace(chr(10), "↵")}"')

    log('\n===== Resume 相关选择器 =====')
    for sel, val in result.get('resumeSelectors', {}).items():
        log(f'  {sel}: len={val["textLen"]}')
        log(f'    "{val["text"][:200].replace(chr(10), "↵")}"')

    log('\n===== Tabs =====')
    for t in result.get('tabs', []):
        log(f'  {t}')

    ctx.close()
