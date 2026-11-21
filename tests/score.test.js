'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const S = require('../extension/src/score.js');
const fixture = require(path.join(__dirname, 'fixtures', 'kazan-designer-2026-11-21.json'));

const NOW = Date.parse(fixture.capturedAt);
const list = fixture.vacancies;
const stats = S.pageStats(list);
const byId = (id) => S.analyze(list.find((v) => v.vacancyId === id), stats, NOW);

test('русские окончания', () => {
  assert.equal(S.plural(1, 'отклик', 'отклика', 'откликов'), 'отклик');
  assert.equal(S.plural(3, 'отклик', 'отклика', 'откликов'), 'отклика');
  assert.equal(S.plural(11, 'отклик', 'отклика', 'откликов'), 'откликов');
  assert.equal(S.plural(21, 'отклик', 'отклика', 'откликов'), 'отклик');
  assert.equal(S.plural(112, 'день', 'дня', 'дней'), 'дней');
});

test('даты hh в трёх форматах', () => {
  const iso = '2026-11-20T15:56:07.869+03:00';
  const t = Date.parse(iso);
  assert.equal(S.toTime(iso), t);
  assert.equal(S.toTime({ '@timestamp': 1795179367, $: iso }), t);
  assert.equal(S.toTime(1795179367), 1795179367000);
  assert.equal(S.toTime(null), null);
});

test('зарплата: до вычета налогов переводится в на руки, без зарплаты — null', () => {
  assert.equal(S.monthlyNet({ from: 100000, currencyCode: 'RUR', gross: true, mode: 'MONTH' }), 87000);
  assert.equal(S.monthlyNet({ from: 60000, to: 100000, currencyCode: 'RUR', gross: false, mode: 'MONTH' }), 80000);
  assert.equal(S.monthlyNet({ noCompensation: {} }), null);
  assert.equal(S.monthlyNet({ from: 1000, currencyCode: 'USD', mode: 'MONTH' }), null);
  assert.equal(S.monthlyNet({ from: 3000, currencyCode: 'RUR', mode: 'SHIFT' }), null);
});

test('медианы по выдаче', () => {
  assert.equal(stats.count, 12);
  assert.equal(stats.medianResponses, 104.5); // (87 + 122) / 2
  assert.ok(stats.medianSalary > 80000 && stats.medianSalary < 130000);
});

test('свежая вакансия с малой конкуренцией и быстрым ответом — высокая оценка', () => {
  const a = byId(139705941);
  assert.equal(a.level, 'high');
  assert.ok(a.score >= 80, `score ${a.score}`);
  assert.ok(a.factors.some((f) => f.key === 'reply' && f.points === 8));
  assert.equal(a.flags.zombie, false);
});

test('висит 3 месяца и переподнимается — зомби, низкая оценка, скрывается фильтром', () => {
  const a = byId(136444795);
  assert.equal(a.flags.zombie, true);
  assert.equal(a.level, 'low');
  assert.equal(a.factors.find((f) => f.key === 'freshness').title, 'Зомби-вакансия');
  assert.match(S.hiddenReason(a, { hideZombie: true }), /^зомби-вакансия, висит 93 дня$/);
  assert.equal(S.hiddenReason(a, { hideZombie: false }), null);
});

test('2 076 откликов — сильный минус и красный чип', () => {
  const a = byId(139023008);
  const c = a.factors.find((f) => f.key === 'competition');
  assert.equal(c.points, -20);
  assert.match(c.detail, /2\s076 откликов/);
  assert.equal(a.chips[0].tone, 'bad');
  assert.match(S.hiddenReason(a, { maxResponses: true }), /больше 100/);
});

test('тестовое задание, письмо, рекрутер онлайн учитываются', () => {
  const t = byId(138982520);
  assert.equal(t.flags.test, true);
  assert.ok(t.chips.some((c) => c.text === 'Тестовое задание'));
  assert.equal(S.hiddenReason(t, { noTest: true }), 'есть тестовое задание');

  const l = byId(139463394);
  assert.equal(l.flags.letter, true);
  assert.equal(S.hiddenReason(l, { onlySalary: true }), 'зарплата не указана');

  const o = byId(139081165);
  assert.equal(o.flags.online, true);
  assert.equal(S.hiddenReason(o, { onlineOnly: true }), null);
  assert.equal(S.hiddenReason(byId(139582801), { onlineOnly: true }), 'рекрутер не в сети');
});

test('оценка всегда 0–100, у каждой вакансии есть факторы и не больше 5 чипов', () => {
  for (const v of list) {
    const a = S.analyze(v, stats, NOW);
    assert.ok(a.score >= 0 && a.score <= 100);
    assert.equal(a.score, Math.max(0, Math.min(100, S.BASE + a.factors.reduce((s, f) => s + f.points, 0))));
    assert.ok(a.factors.length >= 2);
    assert.ok(a.chips.length <= 5);
  }
});

test('пустая вакансия не ломает расчёт', () => {
  const a = S.analyze({ vacancyId: 1 }, {}, NOW);
  assert.equal(a.score, 46); // база 50, зарплата не указана −4
  assert.equal(a.flags.responses, null);
});

test('поиск вакансий в произвольном ответе hh', () => {
  const resp = { a: { vacancySearchResult: { vacancies: list.slice(0, 3) } }, other: [{ x: 1 }], deep: [[{ vacancyId: 5 }]] };
  const found = S.collectVacancies(resp);
  assert.deepEqual(found.map((v) => v.vacancyId).sort(), [5, 139582801, 139663885, 139688647].sort());
});

test('веса: без настроек оценка не меняется, 0 отключает фактор, 2 удваивает', () => {
  const v = list.find((x) => x.vacancyId === 139582801); // 142 отклика, зарплата указана
  const base = S.analyze(v, stats, NOW);
  assert.equal(S.analyze(v, stats, NOW, {}).score, base.score);
  assert.equal(S.analyze(v, stats, NOW, null).score, base.score);

  const comp = base.factors.find((f) => f.key === 'competition');
  const off = S.analyze(v, stats, NOW, { competition: 0 });
  assert.equal(off.factors.find((f) => f.key === 'competition').points, 0);
  assert.equal(off.score, base.score - comp.points);

  const dbl = S.analyze(v, stats, NOW, { competition: 2 });
  assert.equal(dbl.factors.find((f) => f.key === 'competition').points, comp.points * 2);
});

test('веса: мусорные значения игнорируются и ограничиваются 0..2', () => {
  const v = list[0];
  const base = S.analyze(v, stats, NOW);
  assert.equal(S.analyze(v, stats, NOW, { competition: 'x', salary: NaN }).score, base.score);
  const hi = S.analyze(v, stats, NOW, { competition: 99 });
  const comp = base.factors.find((f) => f.key === 'competition');
  assert.equal(hi.factors.find((f) => f.key === 'competition').points, comp.points * 2);
  assert.ok(hi.score >= 0 && hi.score <= 100);
});

test('порог «до N откликов»: настраивается, по умолчанию 100, мусор игнорируется', () => {
  assert.equal(S.responsesLimit({}), 100);
  assert.equal(S.responsesLimit({ responsesLimit: '50' }), 50);
  assert.equal(S.responsesLimit({ responsesLimit: 0 }), 100);
  assert.equal(S.responsesLimit({ responsesLimit: 'abc' }), 100);
  assert.equal(S.responsesLimit({ responsesLimit: 99999 }), 10000);

  const v = list.find((x) => x.vacancyId === 139582801); // 142 отклика
  const a = S.analyze(v, stats, NOW);
  assert.match(S.hiddenReason(a, { maxResponses: true }), /больше 100$/);
  assert.equal(S.hiddenReason(a, { maxResponses: true, responsesLimit: 200 }), null);
  assert.match(S.hiddenReason(a, { maxResponses: true, responsesLimit: 50 }), /142 отклика — больше 50$/);
  assert.equal(S.hiddenReason(a, { maxResponses: false, responsesLimit: 50 }), null);
});

// ---------- 0.8.0: избранное, архив, даты ----------

// Вакансия 138896866 «Начинающий CRM-маркетолог», как её отдаёт hh (21.11.2026):
// в избранном — totalResponsesCount 0, в поиске — 787.
const CRM_FAV = { vacancyId: 138896866, creationTime: '2026-10-27T21:30:05.237+03:00', publicationTime: { $: '2026-10-27T21:30:05.237+03:00', '@timestamp': 1793125805 }, totalResponsesCount: 0, responsesCount: 0, archived: false };
const CRM_SEARCH = { ...CRM_FAV, totalResponsesCount: 787, responsesCount: 545 };
const NOW2 = Date.parse('2026-11-21T20:36:00+03:00');

test('избранное: 0 откликов у hh значит «нет данных», а не «никто не откликнулся»', () => {
  const favList = [CRM_FAV, { ...CRM_FAV, vacancyId: 2 }, { ...CRM_FAV, vacancyId: 3, archived: true }];
  assert.equal(S.countsUnreliable(favList, '/applicant/favorites'), true);
  const [clean] = S.cleanCounts(favList, '/applicant/favorites');
  assert.equal('totalResponsesCount' in clean, false);
  assert.equal(CRM_FAV.totalResponsesCount, 0, 'исходный объект не меняется');
  const a = S.analyze(clean, {}, NOW2);
  assert.equal(a.flags.responses, null);
  assert.ok(!a.factors.some((f) => f.key === 'competition'));
  assert.ok(!a.chips.some((c) => /отклик/.test(c.text)));
  // даже одна вакансия в избранном
  assert.equal(S.countsUnreliable([CRM_FAV], '/applicant/favorite_vacancies'), true);
});

test('поиск: одиночный 0 — настоящий ноль; три нуля подряд — подозрительно', () => {
  const search = [CRM_SEARCH, { ...CRM_FAV, vacancyId: 9 }];
  assert.equal(S.countsUnreliable(search, '/search/vacancy'), false);
  assert.equal(S.cleanCounts(search, '/search/vacancy'), search);
  const zeros = [1, 2, 3].map((id) => ({ ...CRM_FAV, vacancyId: id }));
  assert.equal(S.countsUnreliable(zeros, '/search/vacancy'), true);
  const a = S.analyze(CRM_SEARCH, {}, NOW2);
  assert.equal(a.flags.responses, 787);
  assert.match(a.chips[0].text, /^787 откликов/);
});

test('responsesCount не подменяет totalResponsesCount', () => {
  const a = S.analyze({ vacancyId: 5, responsesCount: 12 }, {}, NOW2);
  assert.equal(a.flags.responses, null);
});

test('архивная вакансия помечается, но не прячется', () => {
  const a = S.analyze({ ...CRM_SEARCH, archived: true }, {}, NOW2);
  assert.equal(a.flags.archived, true);
  assert.equal(a.chips[0].text, 'В архиве — отклик закрыт');
  assert.equal(a.level, 'low');
  assert.equal(S.hiddenReason(a, {}), null);
  const b = S.analyze({ vacancyId: 6, status: { archived: true } }, {}, NOW2);
  assert.equal(b.flags.archived, true);
});

test('даты: «27 окт.», другой год с годом, московское время', () => {
  assert.equal(S.dateText(Date.parse('2026-10-27T21:30:05+03:00'), NOW2), '27 окт.');
  assert.equal(S.dateText(Date.parse('2026-08-20T10:00:00+03:00'), NOW2), '20 авг.');
  assert.equal(S.dateText(Date.parse('2025-12-31T23:30:00+03:00'), NOW2), '31 дек. 2025');
  assert.equal(S.dateText(Date.parse('2026-10-31T22:30:00Z'), NOW2), '1 нояб.'); // 01:30 по Москве
});

test('не переподнималась: только дата создания', () => {
  const a = S.analyze(CRM_SEARCH, {}, NOW2);
  assert.equal(S.datesLine(a), 'создана 27 окт.');
  assert.equal(a.flags.longGap, false);
  assert.match(a.factors.find((f) => f.key === 'freshness').detail, /^Создана 27 окт\. \(24 дня назад\), с тех пор не переподнималась$/);
});

test('опубликована заново через 90 дней — признак продления или возврата из архива', () => {
  const v = { vacancyId: 7, creationTime: '2026-08-20T10:00:00+03:00', publicationTime: '2026-11-18T10:00:00+03:00', totalResponsesCount: 2160 };
  const a = S.analyze(v, {}, NOW2);
  assert.equal(a.flags.longGap, true);
  assert.equal(a.flags.gapDays, 90);
  assert.equal(S.datesLine(a), 'создана 20 авг. · снова опубл. 18 нояб.');
  assert.match(a.factors.find((f) => f.key === 'freshness').detail, /через 90 дней, дольше обычного срока в 30 дней/);
  assert.match(a.factors.find((f) => f.key === 'competition').detail, /копились с 20 авг\./);
  assert.ok(a.chips.some((c) => c.text === 'Висит 93 дня, снова опубл. 18 нояб.'));
});

test('переподнята внутри срока — без предупреждения про архив', () => {
  const v = { vacancyId: 8, creationTime: '2026-11-01T10:00:00+03:00', publicationTime: '2026-11-15T10:00:00+03:00', totalResponsesCount: 50 };
  const a = S.analyze(v, {}, NOW2);
  assert.equal(a.flags.longGap, false);
  assert.equal(S.datesLine(a), 'создана 1 нояб. · снова опубл. 15 нояб.');
  assert.match(a.factors.find((f) => f.key === 'freshness').detail, /переподнята 15 нояб\.$/);
  assert.doesNotMatch(a.factors.find((f) => f.key === 'competition').detail, /копились/);
});
