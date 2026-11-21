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

  // Палитра тёмной темы YouTube вместо ночной палитры hh. Имена переменных цвета у hh
  // содержат номер версии (…-v26-0-3) и меняются, поэтому подменяем по значению:
  // ищем все переменные hh с «ночным» серым цветом и переопределяем их.
  const YT = {
    '#000': '#0f0f0f', '#000000': '#0f0f0f', '#111': '#0f0f0f', '#111111': '#0f0f0f', '#0d1115': '#0f0f0f', // фон страницы
    '#1b1b1b': '#212121',  // карточки
    '#262626': '#272727',  // кнопки, плашки
    '#303030': '#383838',  // вторичные кнопки, рамки
    '#3b3b3b': '#3f3f3f', '#474747': '#4d4d4d', '#535353': '#575757',
    '#fff': '#f1f1f1', '#ffffff': '#f1f1f1', // основной текст
    '#ababab': '#aaaaaa', '#848484': '#909090', '#767676': '#717171',
    '#5e9eff': '#3ea6ff',  // ссылки
  };
  let ytReady = false;

  function ytPalette() {
    const b = document.body;
    if (ytReady || !b || !b.classList.contains(NIGHT)) return;
    const cs = getComputedStyle(b);
    const rules = [];
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      if (!name.startsWith('--magritte-color-')) continue;
      const v = cs.getPropertyValue(name).trim().toLowerCase();
      if (YT[v]) rules.push(`${name}:${YT[v]}`);
    }
    if (!rules.length) return; // стили hh ещё не загрузились — попробуем позже
    const st = document.createElement('style');
    st.id = 'rv-yt-palette';
    st.textContent = `html .${NIGHT}{${rules.join(';')}}`;
    (document.head || document.documentElement).append(st);
    ytReady = true;
  }

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
    html.style.backgroundColor = want === 'night' ? '#0f0f0f' : '';
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
    nested();
    if (!want) html.style.backgroundColor = '';
    ytPalette();
  }

  // У встроенных модулей hh (например, блоков других команд) бывает своя тема на вложенном
  // контейнере. Перекрашиваем и их, запоминая исходную тему, чтобы вернуть в режиме 'site'.
  function nested() {
    const b = document.body;
    if (!b) return;
    const want = wanted();
    if (want) {
      const from = want === 'night' ? DAY : NIGHT;
      const to = want === 'night' ? NIGHT : DAY;
      b.querySelectorAll('.' + from).forEach((el) => {
        if (!el.dataset.rvThemeOrig) el.dataset.rvThemeOrig = from;
        el.classList.replace(from, to);
      });
    } else {
      b.querySelectorAll('[data-rv-theme-orig]').forEach((el) => {
        const orig = el.dataset.rvThemeOrig;
        el.classList.remove(DAY, NIGHT);
        el.classList.add(orig);
        delete el.dataset.rvThemeOrig;
      });
    }
  }
  let nestedTimer = null;
  new MutationObserver((muts) => {
    if (!wanted() || nestedTimer) return;
    for (const m of muts) if (m.addedNodes.length) {
      nestedTimer = setTimeout(() => { nestedTimer = null; nested(); }, 50);
      return;
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

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

  // Палитру можно собрать, только когда стили hh загружены.
  document.addEventListener('DOMContentLoaded', () => { watchBody(); ytPalette(); }, { once: true });
  window.addEventListener('load', ytPalette, { once: true });

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
