/**
 * CVFilterX - API 拦截器（注入到页面上下文）
 *
 * 拦截飞书招聘评估列表 API（/evaluation/list_v2/），
 * 通过 CustomEvent 将数据传递给 content script。
 *
 * 注意：此文件在页面上下文（而非 content script 隔离环境）中运行，
 * 由 api-inject.js 通过 <script src="..."> 注入。
 */
(function () {
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _fetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (url.includes('/evaluation/list_v2')) {
      res.clone().json().then(data => {
        document.dispatchEvent(new CustomEvent('cvfx:eval-list', { detail: data }));
      }).catch(() => {});
    }
    return res;
  };
})();
