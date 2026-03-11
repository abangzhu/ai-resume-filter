/**
 * CVFilterX - Template Selection Dialog
 * Extracted from content.js
 */

function showTemplateDialog(jobTitle, templates, suggested) {
  return new Promise((resolve) => {
    document.getElementById('cvfx-template-dialog')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'cvfx-template-dialog';
    overlay.innerHTML = `
      <div class="cvfx-tpl-backdrop"></div>
      <div class="cvfx-tpl-panel">
        <div class="cvfx-tpl-title">选择评分模板</div>
        ${jobTitle ? `<div class="cvfx-tpl-subtitle">当前岗位：${escHtml(jobTitle)}</div>` : ''}
        <div class="cvfx-tpl-list">
          ${templates.map(t => {
            const isSuggested = suggested && t.id === suggested.id;
            return `
              <label class="cvfx-tpl-option${isSuggested ? ' suggested' : ''}">
                <input type="radio" name="cvfx-tpl" value="${t.id}" ${isSuggested ? 'checked' : ''}>
                <div class="cvfx-tpl-info">
                  <span class="cvfx-tpl-name">${escHtml(t.name)}</span>
                  ${isSuggested ? '<span class="cvfx-tpl-tag">推荐</span>' : ''}
                  ${t.isDefault ? '<span class="cvfx-tpl-tag default">默认</span>' : ''}
                  <span class="cvfx-tpl-desc">${escHtml(t.description || '')}</span>
                </div>
              </label>
            `;
          }).join('')}
        </div>
        <div class="cvfx-tpl-actions">
          <button class="cvfx-tpl-btn cancel">取消</button>
          <button class="cvfx-tpl-btn confirm">确认</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cleanup = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector('.cvfx-tpl-backdrop').addEventListener('click', () => cleanup(null));
    overlay.querySelector('.cvfx-tpl-btn.cancel').addEventListener('click', () => cleanup(null));
    overlay.querySelector('.cvfx-tpl-btn.confirm').addEventListener('click', () => {
      const selected = overlay.querySelector('input[name="cvfx-tpl"]:checked');
      cleanup(selected?.value || null);
    });
  });
}

window.__cvfx = window.__cvfx || {};
Object.assign(window.__cvfx, { showTemplateDialog });
