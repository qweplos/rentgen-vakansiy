/*
 * ХаХантер — тёмная тема для самого hh.ru.
 * У hh на сайте уже есть ночная тема (класс magritte-night-theme на <body>), но переключателя
 * для пользователей нет. Этот скрипт включает её по настройке расширения.
 * Запускается в самом начале загрузки, чтобы страница не мигала светлой темой.
 * Режимы (rvSettings.siteTheme): 'site' — не трогать, 'night' — всегда тёмная, 'system' — как в системе.
 */
(function () {
  'use strict';
  if (window.__rvTheme) return;
  window.__rvTheme = true;

  const c = globalThis.chrome;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const DAY = 'magritte-day-theme';
  const NIGHT = 'magritte-night-theme';
  let mode = 'site';
  let original = null; // тема, которую выдал сам hh, — к ней возвращаемся в режиме 'site'
  let bodyObserver = null;

  function wanted() {
    if (mode === 'night') return 'night';
    if (mode === 'system') return mq.matches ? 'night' : 'day';
    return null;
  }

  function apply() {
    const want = wanted();
    const html = document.documentElement;
    const b = document.body;
    // Пока <body> нет, красим фон документа, чтобы не было белой вспышки.
    html.style.backgroundColor = want === 'night' ? '#000' : '';
    if (!b) return;
    if (original === null) {
      original = b.classList.contains(NIGHT) ? 'night' : b.classList.contains(DAY) ? 'day' : '';
    }
    const target = want || original;
    if (!target) return;
    const add = target === 'night' ? NIGHT : DAY;
    const remove = target === 'night' ? DAY : NIGHT;
    if (b.classList.contains(remove)) b.classList.remove(remove);
    if (!b.classList.contains(add)) b.classList.add(add);
    html.style.colorScheme = want ? (target === 'night' ? 'dark' : 'light') : '';
    if (!want) html.style.backgroundColor = '';
  }

  // Если hh перерисует <body> и вернёт свою тему — ставим нашу обратно.
  function watchBody() {
    if (!document.body || bodyObserver) return;
    bodyObserver = new MutationObserver(() => { if (wanted()) apply(); });
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    apply();
  }

  if (document.body) watchBody();
  else {
    const mo = new MutationObserver(() => {
      if (document.body) { mo.disconnect(); watchBody(); }
    });
    mo.observe(document.documentElement, { childList: true });
  }

  function setMode(m) {
    const next = m === 'night' || m === 'system' ? m : 'site';
    if (next === mode) return;
    mode = next;
    apply();
  }

  mq.addEventListener('change', () => { if (mode === 'system') apply(); });

  if (c && c.storage && c.storage.local) {
    try {
      c.storage.local.get('rvSettings', (x) => setMode(x && x.rvSettings && x.rvSettings.siteTheme));
      c.storage.onChanged.addListener((ch, area) => {
        if (area === 'local' && ch.rvSettings && ch.rvSettings.newValue) setMode(ch.rvSettings.newValue.siteTheme);
      });
    } catch (e) { /* без API расширения — ничего не делаем */ }
  }

  // Для проверки без установленного расширения.
  window.__rvSetSiteTheme = setMode;
})();
