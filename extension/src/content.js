/*
 * Рентген вакансий — интерфейс на страницах hh.ru.
 * Берёт данные из HH-Lux-InitialState (первая загрузка) и из hook.js (листание, фильтры),
 * считает оценку через RVScore и встраивает бейдж, чипы, панель и расшифровку.
 * Сетевых запросов не делает.
 */
(function () {
  'use strict';
  if (window.__rvContent) return;
  window.__rvContent = true;

  const S = globalThis.RVScore;
  if (!S) return;

  const CARD = '[data-qa="vacancy-serp__vacancy"]';
  const TITLE = '[data-qa="serp-item__title"]';
  const OURS = '.rv-toolbar,.rv-badge,.rv-strip,.rv-collapsed,.rv-pop';
  const DEFAULTS = { hideZombie: true, maxResponses: false, onlySalary: false, noTest: false, onlineOnly: false, sort: 'score' };
  const FILTERS = [
    ['hideZombie', 'Скрыть зомби-вакансии'],
    ['maxResponses', 'До 100 откликов'],
    ['onlySalary', 'Только с зарплатой'],
    ['noTest', 'Без тестового'],
    ['onlineOnly', 'Рекрутер онлайн'],
  ];
  const MINUS = '−';

  const data = new Map();      // id вакансии -> данные hh
  const revealed = new Set();  // скрытые вакансии, которые пользователь раскрыл
  const analysisOf = new WeakMap(); // бейдж -> результат analyze
  let settings = { ...DEFAULTS };
  let timer = null;

  // ---------- хранение настроек ----------
  const store = (() => {
    const c = globalThis.chrome;
    if (c && c.storage && c.storage.local) {
      return {
        get: () => new Promise((res) => { try { c.storage.local.get('rvSettings', (x) => res(x && x.rvSettings)); } catch (e) { res(null); } }),
        set: (v) => { try { c.storage.local.set({ rvSettings: v }); } catch (e) { /* ignore */ } },
      };
    }
    let mem = null; // запасной вариант без API расширения (проверка в консоли)
    return { get: async () => mem, set: (v) => { mem = v; } };
  })();

  // ---------- мелкие помощники ----------
  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children || [])) if (c != null) el.append(c);
    return el;
  }
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const pts = (n) => (n > 0 ? `+${n}` : n < 0 ? `${MINUS}${Math.abs(n)}` : '0');

  function idOf(card) {
    const a = card.querySelector(TITLE);
    const m = a && (a.getAttribute('href') || '').match(/\/vacancy\/(\d+)/);
    return m ? m[1] : null;
  }

  function isOurs(n) {
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    return !!(el && el.closest && el.closest(OURS));
  }

  // ---------- данные ----------
  function ingest(list) {
    let added = 0;
    for (const v of list) {
      if (!v || v.vacancyId == null) continue;
      data.set(String(v.vacancyId), v);
      added++;
    }
    if (added) schedule();
  }

  function readInitialState() {
    const t = document.getElementById('HH-Lux-InitialState');
    if (!t) return;
    const text = (t.content && t.content.textContent) || t.textContent || t.innerHTML;
    try { ingest(S.collectVacancies(JSON.parse(text))); } catch (e) { /* формат поменялся — просто ничего не покажем */ }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'rv-hook' || !Array.isArray(e.data.vacancies)) return;
    ingest(e.data.vacancies);
  });

  // ---------- карточка ----------
  function buildBadge(a) {
    const b = h('div', { class: `rv-badge rv-${a.level}`, tabindex: '0', role: 'button', 'aria-label': `Оценка вакансии ${a.score} из 100, ${a.levelText}` }, [
      h('b', { text: String(a.score) }),
      h('span', { text: 'из 100' }),
    ]);
    analysisOf.set(b, a);
    return b;
  }

  function buildStrip(a) {
    return h('div', { class: 'rv-strip' }, [
      h('span', { class: 'rv-mark', title: 'Рентген вакансий', text: 'Р' }),
      ...a.chips.map((c) => h('span', { class: 'rv-chip' }, [h('i', { class: `rv-dot rv-dot-${c.tone}` }), c.text])),
    ]);
  }

  function decorate(card, a) {
    const key = `${a.id}:${a.score}:${a.chips.map((c) => c.text).join('|')}`;
    card.classList.add('rv-card');
    const badgeOk = card.querySelector(':scope > .rv-badge');
    const stripOk = card.querySelector('.rv-strip');
    if (card.dataset.rvKey === key && badgeOk && stripOk) {
      analysisOf.set(badgeOk, a);
      return;
    }
    card.querySelectorAll('.rv-badge, .rv-strip').forEach((n) => n.remove());
    card.dataset.rvKey = key;
    card.append(buildBadge(a));
    const strip = buildStrip(a);
    const row = buttonsRow(card);
    if (row && row.parentNode) row.parentNode.insertBefore(strip, row);
    else (card.firstElementChild || card).append(strip);
  }

  // Ряд с кнопками «Откликнуться» и «Контакты» — полоса встаёт прямо над ним.
  // Привязка к кнопкам, а не к классам: у карточек с логотипом другая вёрстка.
  function buttonsRow(card) {
    const resp = card.querySelector('[data-qa="vacancy-serp__vacancy_response"]');
    if (!resp) return null;
    const contacts = card.querySelector('[data-qa="vacancy-serp__vacancy_contacts"]');
    let row = resp.parentElement;
    if (contacts) while (row && row !== card && !row.contains(contacts)) row = row.parentElement;
    return row && row !== card ? row : null;
  }

  function applyHidden(card, a, reason) {
    card.classList.toggle('rv-hidden', !!reason);
    let row = card.querySelector(':scope > .rv-collapsed');
    if (!reason) { if (row) row.remove(); return; }
    const name = ((card.querySelector(TITLE) || {}).textContent || 'вакансия').trim();
    const text = `Скрыто: «${name}» — ${reason}`;
    if (row && row.dataset.text === text) return;
    if (row) row.remove();
    row = h('div', { class: 'rv-collapsed', 'data-text': text }, [
      h('span', { class: `rv-mini rv-${a.level}`, text: String(a.score) }),
      h('span', { class: 'rv-collapsed-text', text }),
      h('button', { type: 'button', class: 'rv-show', text: 'Показать', onclick: (e) => { e.preventDefault(); e.stopPropagation(); revealed.add(a.id); render(); } }),
    ]);
    card.append(row);
  }

  // ---------- панель ----------
  function buildToolbar() {
    const select = h('select', { class: 'rv-select', 'aria-label': 'Сортировка' }, [
      h('option', { value: 'score', text: 'Сначала лучшие' }),
      h('option', { value: 'hh', text: 'Как на hh' }),
    ]);
    select.addEventListener('change', () => update({ sort: select.value }));
    return h('div', { class: 'rv-toolbar' }, [
      h('div', { class: 'rv-row' }, [
        h('span', { class: 'rv-mark rv-mark-lg', text: 'Р' }),
        h('b', { class: 'rv-title', text: 'Рентген вакансий' }),
        h('span', { class: 'rv-summary' }),
        h('label', { class: 'rv-sort' }, ['Сортировка:', select]),
      ]),
      h('div', { class: 'rv-row rv-filters' }, FILTERS.map(([k, label]) =>
        h('button', { type: 'button', class: 'rv-filter', 'data-key': k, 'aria-pressed': 'false', text: label, onclick: () => update({ [k]: !settings[k] }) }))),
    ]);
  }

  function update(patch) {
    settings = { ...settings, ...patch };
    store.set(settings);
    revealed.clear();
    render();
  }

  function syncToolbar(list, summary) {
    let tb = document.querySelector('.rv-toolbar');
    if (!tb) tb = buildToolbar();
    if (tb.nextElementSibling !== list) list.parentNode.insertBefore(tb, list);
    setText(tb.querySelector('.rv-summary'), summary);
    const sel = tb.querySelector('.rv-select');
    if (sel.value !== settings.sort) sel.value = settings.sort;
    tb.querySelectorAll('.rv-filter').forEach((b) => {
      const on = String(!!settings[b.dataset.key]);
      if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on);
    });
  }

  // ---------- сортировка ----------
  function applySort(list, items) {
    const lis = [...list.children];
    if (settings.sort !== 'score') {
      list.classList.remove('rv-sorted');
      for (const li of lis) if (li.dataset.rvOrder) { li.style.order = ''; delete li.dataset.rvOrder; }
      return;
    }
    list.classList.add('rv-sorted');
    const rank = new Map();
    [...items].sort((x, y) => y.a.score - x.a.score).forEach((it, i) => rank.set(it.li, i + 1));
    for (const li of lis) {
      const o = String(rank.has(li) ? rank.get(li) : 9999);
      if (li.dataset.rvOrder !== o) { li.dataset.rvOrder = o; li.style.order = o; }
    }
  }

  // ---------- главный проход ----------
  function render() {
    const cards = [...document.querySelectorAll(CARD)];
    if (!cards.length) return;
    const list = cards[0].closest('ol, ul') || cards[0].parentElement.parentElement;

    const items = [];
    for (const card of cards) {
      const id = idOf(card);
      const v = id && data.get(id);
      if (v) items.push({ card, id, v, li: card.closest('li') });
    }
    const stats = S.pageStats(items.map((i) => i.v));
    let hidden = 0;
    for (const it of items) {
      it.a = S.analyze(it.v, stats);
      decorate(it.card, it.a);
      const reason = revealed.has(it.id) ? null : S.hiddenReason(it.a, settings);
      if (reason) hidden++;
      applyHidden(it.card, it.a, reason);
    }
    if (list) {
      applySort(list, items.filter((i) => i.li && i.li.parentElement === list));
      let summary = 'Жду данные страницы…';
      if (items.length) {
        summary = `${items.length} на странице · скрыто ${hidden}`;
        if (stats.medianResponses != null) {
          const m = Math.round(stats.medianResponses);
          summary += ` · медиана ${S.fmtInt(m)} ${S.plural(m, 'отклик', 'отклика', 'откликов')}`;
        }
      }
      syncToolbar(list, summary);
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; try { render(); } catch (e) { /* не ломаем страницу */ } }, 120);
  }

  // ---------- расшифровка оценки ----------
  let pop = null;
  let popFor = null;
  let hideTimer = null;

  function showPop(badge) {
    const a = analysisOf.get(badge);
    if (!a) return;
    clearTimeout(hideTimer);
    if (!pop) {
      pop = h('div', { class: 'rv-pop', role: 'tooltip' });
      pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
      pop.addEventListener('mouseleave', scheduleHide);
      document.body.append(pop);
    }
    popFor = badge;
    pop.replaceChildren(
      h('div', { class: 'rv-pop-head' }, [
        h('b', { class: `rv-pop-score rv-fg-${a.level}`, text: String(a.score) }),
        h('span', { text: `из 100 · ${a.levelText}` }),
      ]),
      h('div', { class: 'rv-bar' }, [h('i', { class: `rv-bar-${a.level}`, style: `width:${a.score}%` })]),
      ...a.factors.map((f) => h('div', { class: 'rv-row-f' }, [
        h('div', null, [h('div', { class: 'rv-f-title', text: f.title }), h('div', { class: 'rv-f-detail', text: f.detail })]),
        h('b', { class: f.points > 0 ? 'rv-plus' : f.points < 0 ? 'rv-minus' : 'rv-zero', text: pts(f.points) }),
      ])),
      h('div', { class: 'rv-pop-foot', text: `База — ${S.BASE} баллов. Всё считается по данным самой страницы hh.ru, расширение ничего никуда не отправляет.` }),
    );
    pop.style.display = 'block';
    const r = badge.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = Math.max(8, Math.min(r.right - w, document.documentElement.clientWidth - w - 8));
    let top = r.bottom + 8;
    if (top + pop.offsetHeight > window.innerHeight - 8 && r.top - pop.offsetHeight - 8 > 0) top = r.top - pop.offsetHeight - 8;
    pop.style.left = `${left + window.scrollX}px`;
    pop.style.top = `${top + window.scrollY}px`;
  }

  function hidePop() {
    if (pop) pop.style.display = 'none';
    popFor = null;
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePop, 160);
  }

  document.addEventListener('mouseover', (e) => {
    const b = e.target.closest && e.target.closest('.rv-badge');
    if (b && b !== popFor) showPop(b);
  });
  document.addEventListener('mouseout', (e) => {
    const b = e.target.closest && e.target.closest('.rv-badge');
    if (b && !(e.relatedTarget && (b.contains(e.relatedTarget) || (pop && pop.contains(e.relatedTarget))))) scheduleHide();
  });
  document.addEventListener('focusin', (e) => { if (e.target.classList && e.target.classList.contains('rv-badge')) showPop(e.target); });
  document.addEventListener('focusout', (e) => { if (e.target.classList && e.target.classList.contains('rv-badge')) scheduleHide(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.rv-badge');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (popFor === b) hidePop(); else showPop(b);
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePop(); });
  window.addEventListener('scroll', () => { if (popFor && !popFor.isConnected) hidePop(); }, { passive: true });

  // ---------- запуск ----------
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (isOurs(m.target)) continue;
      for (const n of m.addedNodes) if (!isOurs(n)) return schedule();
      for (const n of m.removedNodes) if (!(n.nodeType === 1 && n.matches && n.matches(OURS))) return schedule();
    }
  });

  store.get().then((saved) => {
    if (saved && typeof saved === 'object') settings = { ...DEFAULTS, ...saved };
    readInitialState();
    schedule();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
})();
