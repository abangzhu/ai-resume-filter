/**
 * CVFilterX - API 注入器（document_start content script）
 *
 * 在页面脚本执行前将 api-interceptor.js 注入到页面上下文，
 * 确保 fetch 拦截器在飞书页面发起 API 请求前就已就位。
 */
(function () {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/api-interceptor.js');
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove();
})();
