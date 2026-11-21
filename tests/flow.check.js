// Сквозная проверка: избранное → поиск → вакансия → снова избранное, общее хранилище chrome.storage.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const SRC = require('path').join(__dirname, '..', 'extension', 'src') + '/';
const score = fs.readFileSync(SRC + 'score.js', 'utf8');
const content = fs.readFileSync(SRC + 'content.js', 'utf8');
const store = {};
const listeners = [];
function chromeMock() {
  return { storage: { local: {
    get: (k, cb) => cb({ [k]: store[k] && JSON.parse(JSON.stringify(store[k])) }),
    set: (o) => { const ch = {}; for (const k in o) { ch[k] = { newValue: o[k] }; store[k] = JSON.parse(JSON.stringify(o[k])); } listeners.forEach((l) => l(ch, 'local')); },
  }, onChanged: { addListener: (l) => listeners.push(l) } } };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const V = (extra) => ({ vacancyId: 138896866, name: 'Начинающий CRM-маркетолог', creationTime: '2026-10-27T21:30:05.237+03:00', publicationTime: { $: '2026-10-27T21:30:05.237+03:00', '@timestamp': 1793125805 }, compensation: { from: 30000, currencyCode: 'RUR', gross: false, mode: 'MONTH' }, '@responseLetterRequired': true, ...extra });
const card = (v) => `<li><div data-qa="vacancy-serp__vacancy"><a data-qa="serp-item__title" href="/vacancy/${v.vacancyId}">${v.name}</a><div><button data-qa="vacancy-serp__vacancy_response">Откликнуться</button><a data-qa="vacancy-serp__vacancy_contacts">Контакты</a></div></div></li>`;
async function page(url, list, extraBody = '') {
  const html = `<!doctype html><html><head></head><body class="magritte-night-theme"><template id="HH-Lux-InitialState">${JSON.stringify({ x: { vacancies: list } })}</template><main><h1 data-qa="vacancy-title">Начинающий CRM-маркетолог</h1><ol>${url.includes('/vacancy/') ? '' : list.map(card).join('')}</ol>${extraBody}</main></body></html>`;
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.chrome = chromeMock();
  dom.window.eval(score); dom.window.eval(content);
  await sleep(1900);
  return dom.window.document;
}
const chips = (doc) => [...doc.querySelectorAll('.rv-chip')].map((c) => c.textContent).join(' | ');
let fail = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); if (!ok) fail++; };
(async () => {
  // 1. Поиск: 787 откликов попадает в кеш.
  const others = [2, 3, 4, 5, 6].map((i) => V({ vacancyId: i, name: 'v' + i, totalResponsesCount: 100 * i, compensation: { from: 60000 + i * 1000, currencyCode: 'RUR', mode: 'MONTH' } }));
  let d = await page('https://kazan.hh.ru/search/vacancy?text=crm', [V({ totalResponsesCount: 787, responsesCount: 545 }), ...others]);
  check('поиск: чип 787', /787 откликов/.test(chips(d)), chips(d).slice(0, 80));
  check('поиск: кеш 787', store.rvSeen && store.rvSeen['138896866'].v.totalResponsesCount === 787);
  check('поиск: медиана в сводке', /медиана/.test(d.querySelector('.rv-summary').textContent));
  // 2. Избранное: hh отдаёт 0 — не показываем «0 откликов» и не затираем кеш.
  d = await page('https://kazan.hh.ru/applicant/favorites?tab=vacancies', [V({ totalResponsesCount: 0, responsesCount: 0 }), V({ vacancyId: 7, name: 'Архивная', totalResponsesCount: 0, responsesCount: 0, archived: true })]);
  check('избранное: нет «0 откликов»', !/0 откликов|меньше 1 в день/.test(chips(d)), chips(d));
  check('избранное: нет «ниже медианы»', !/медиан/.test(chips(d)));
  check('избранное: архивная помечена', /В архиве — отклик закрыт/.test(chips(d)));
  check('избранное: архивная не спрятана', !d.querySelector('[href="/vacancy/7"]').closest('.rv-card').classList.contains('rv-hidden'));
  check('избранное: кеш остался 787', store.rvSeen['138896866'].v.totalResponsesCount === 787, String(store.rvSeen['138896866'].v.totalResponsesCount));
  check('избранное: сводка без медианы', !/медиана/.test(d.querySelector('.rv-summary').textContent), d.querySelector('.rv-summary').textContent);
  // 3. Страница вакансии: берёт 787.
  d = await page('https://kazan.hh.ru/vacancy/138896866', []);
  check('вакансия: панель с 787', /787 откликов/.test(chips(d)), chips(d));
  // 4. Меньшее число из другого списка не затирает большее.
  d = await page('https://kazan.hh.ru/search/vacancy?text=x', [V({ totalResponsesCount: 500 }), ...others]);
  check('кеш не уменьшается', store.rvSeen['138896866'].v.totalResponsesCount === 787);
  // 5. Скрытая строка: две строки, даты, причина.
  store.rvSettings = { hideZombie: true, maxResponses: true, responsesLimit: 150 };
  const old = V({ vacancyId: 11, name: 'Специалист по маркетингу/маркетолог', creationTime: '2026-08-20T10:00:00+03:00', publicationTime: new Date(Date.now() - 2 * 864e5).toISOString(), totalResponsesCount: 228 });
  d = await page('https://kazan.hh.ru/search/vacancy?text=m', [old, ...others]);
  const row = d.querySelector('[href="/vacancy/11"]').closest('.rv-card').querySelector('.rv-collapsed');
  check('скрытая: есть строка', !!row);
  check('скрытая: название отдельно', row && row.querySelector('.rv-c-name').textContent === 'Специалист по маркетингу/маркетолог');
  const meta = row && row.querySelector('.rv-c-meta').textContent;
  check('скрытая: причина и даты', /^Скрыто: зомби-вакансия, висит \d+ дн(я|ей)создана 20 авг\. · снова опубл\. \d+ нояб\.отклики копились с даты создания$/.test(meta), meta);
  check('скрытая: даты подсвечены', !!row.querySelector('.rv-c-warn'));
  console.log(fail ? `\nОШИБОК: ${fail}` : '\nВсё прошло');
  process.exit(fail ? 1 : 0);
})();
