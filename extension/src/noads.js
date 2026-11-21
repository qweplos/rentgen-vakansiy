/*
 * ХаХантер — скрытие рекламы на hh.ru.
 * 1) Рекламные места hh (Adfox) прячет noads.css по классу rv-noads на <html>.
 * 2) Рекламу без явной пометки в коде (блок «Курсы по профессии» с промокодами,
 *    карточки с меткой «Реклама») находим по тексту и помечаем data-rv-ad.
 * Настройка rvSettings.hideAds, по умолчанию включено. Ничего не удаляет из страницы —
 * только скрывает, поэтому выключение настройки сразу всё возвращает.
 */
(function () {
  'use strict';
  if (window.__rvNoAds) return;
  window.__rvNoAds = true;

  const c = globalThis.chrome;
  const html = document.documentElement;
  let on = true;
  html.classList.add('rv-noads'); // сразу, чтобы реклама не мелькнула до чтения настроек

  const COURSES = /^Курсы по профессии/i;
  const PROMO = /по промокоду\s*HH\d*/i;
  const AD_LABEL = /^Реклама$/;
  const DAY_VACANCIES = /^Вакансии дня/i; // платное размещение работодателей на главной
  // Рекламные карточки hh с явной меткой в коде: «Развитие карьеры» (курсы) и платная подписка hh pro.
  const AD_QA = '[data-qa="applicant-index-nba-action_career-banner"], [data-qa^="applicant-index-nba-action_hhpro"]';

  // Карточку прячем вместе с обёртками, в которых больше ничего нет, — чтобы не оставалось пустого места.
  function shell(el) {
    let node = el;
    while (node.parentElement && node.parentElement.children.length === 1 && !node.parentElement.matches(STOP)) node = node.parentElement;
    return node;
  }

  // Раздел главной «Вакансии дня»: заголовок и блоки после него до следующего заголовка.
  function sectionAfter(titleEl) {
    const head = titleEl.closest('[data-qa="title-container"]') || titleEl;
    const out = [head];
    let n = head.nextElementSibling;
    for (let i = 0; n && i < 8; i++, n = n.nextElementSibling) {
      if (n.matches('[data-qa="title-container"]') || n.querySelector('[data-qa="title-container"]')) break;
      out.push(n);
    }
    return out;
  }

  function textOf(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }

  // Поднимаемся от найденного заголовка до блока, где лежат сами карточки курсов,
  // и прихватываем обёртки, которые ничего кроме этого блока не содержат.
  const STOP = 'body, main, [data-qa="main-content"], #HH-React-Root';
  const prices = (el) => (textOf(el).match(/₽/g) || []).length;

  function blockAround(el) {
    // 1) Наименьший блок, где уже есть цены (карточка курса или весь раздел с карточками).
    let node = el;
    for (let i = 0; i < 12 && prices(node) < 2; i++) {
      const p = node.parentElement;
      if (!p || p.matches(STOP)) return null;
      node = p;
    }
    if (prices(node) < 2) return null;
    // 2) Плюс обёртки вокруг него, в которых нет ничего заметного кроме этого блока.
    for (let i = 0; i < 8; i++) {
      const p = node.parentElement;
      if (!p || p.matches(STOP)) break;
      if (textOf(p).length > textOf(node).length * 1.2 + 40) break;
      node = p;
    }
    return node;
  }

  function scan() {
    if (!on || !document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const found = new Set();
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const s = t.nodeValue;
      if (!s || s.length > 120) continue;
      const el = t.parentElement;
      if (!el || el.closest('[data-rv-ad], .rv-toolbar, .rv-pop, .rv-vpanel, footer')) continue;
      const v = s.trim();
      if (DAY_VACANCIES.test(v) && el.closest('[data-qa="title-container"]')) sectionAfter(el).forEach((x) => found.add(x));
      else if (COURSES.test(v)) found.add(blockAround(el));
      else if (PROMO.test(v)) found.add(blockAround(el));
      else if (AD_LABEL.test(v)) {
        const card = el.closest('[data-qa="vacancy-serp__vacancy"], article, li');
        if (card) found.add(card);
      }
    }
    document.querySelectorAll(AD_QA).forEach((el) => found.add(shell(el)));
    for (const el of found) if (el) el.setAttribute('data-rv-ad', '');
  }

  let timer = null;
  function schedule() {
    if (timer || !on) return;
    timer = setTimeout(() => { timer = null; try { scan(); } catch (e) { /* не ломаем страницу */ } }, 250);
  }

  function setOn(v) {
    on = v !== false;
    html.classList.toggle('rv-noads', on);
    if (on) schedule();
  }

  const mo = new MutationObserver((muts) => {
    for (const m of muts) if (m.addedNodes.length) return schedule();
  });
  mo.observe(html, { childList: true, subtree: true });
  if (document.readyState !== 'loading') schedule();
  else document.addEventListener('DOMContentLoaded', schedule, { once: true });

  if (c && c.storage && c.storage.local) {
    try {
      c.storage.local.get('rvSettings', (x) => setOn(!(x && x.rvSettings && x.rvSettings.hideAds === false)));
      c.storage.onChanged.addListener((ch, area) => {
        if (area === 'local' && ch.rvSettings && ch.rvSettings.newValue) setOn(ch.rvSettings.newValue.hideAds !== false);
      });
    } catch (e) { /* ignore */ }
  }
})();
