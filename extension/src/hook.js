/*
 * ХаХантер — перехват данных при листании выдачи.
 * Работает в контексте страницы (world: MAIN), запускается до скриптов hh.
 * Ничего не отправляет и не меняет: читает копию ответов hh.ru со своего же домена
 * и передаёт найденные вакансии в content.js через window.postMessage.
 */
(function () {
  'use strict';
  if (window.__rvHook) return;
  window.__rvHook = true;

  const KEEP = [
    'vacancyId', 'creationTime', 'publicationTime', 'responsesCount', 'totalResponsesCount',
    'userTestPresent', '@responseLetterRequired', 'compensation', 'labels', 'extraLabels',
  ];

  function trim(v) {
    const r = {};
    for (const k of KEEP) if (k in v) r[k] = v[k];
    if (v.employerManager) r.employerManager = { latestActivity: v.employerManager.latestActivity };
    return r;
  }

  function collect(o, out, depth, seen) {
    if (!o || typeof o !== 'object' || depth > 12 || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
      if (o.length && o[0] && typeof o[0] === 'object' && 'vacancyId' in o[0]) {
        for (const v of o) if (v && v.vacancyId != null) out.push(trim(v));
        return;
      }
      for (const x of o) collect(x, out, depth + 1, seen);
      return;
    }
    for (const k of Object.keys(o)) collect(o[k], out, depth + 1, seen);
  }

  function handle(text) {
    if (typeof text !== 'string' || text.length < 20 || text.indexOf('vacancyId') === -1) return;
    let json;
    try { json = JSON.parse(text); } catch (e) { return; }
    const out = [];
    collect(json, out, 0, new WeakSet());
    if (out.length) window.postMessage({ source: 'rv-hook', vacancies: out }, location.origin);
  }

  function sameOrigin(u) {
    try { return new URL(u, location.href).origin === location.origin; } catch (e) { return false; }
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__rvUrl = url;
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (sameOrigin(this.__rvUrl)) {
      this.addEventListener('load', function () {
        try {
          if (this.responseType === '' || this.responseType === 'text') handle(this.responseText);
          else if (this.responseType === 'json' && this.response) handle(JSON.stringify(this.response));
        } catch (e) { /* не мешаем странице */ }
      });
    }
    return xhrSend.apply(this, arguments);
  };

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : input && input.url;
        if (sameOrigin(url)) {
          p.then((r) => {
            const ct = (r.headers && r.headers.get('content-type')) || '';
            if (ct.includes('json')) r.clone().text().then(handle).catch(() => {});
          }).catch(() => {});
        }
      } catch (e) { /* не мешаем странице */ }
      return p;
    };
  }
})();
