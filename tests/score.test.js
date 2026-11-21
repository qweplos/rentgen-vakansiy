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
