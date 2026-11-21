/*
 * Рентген вакансий — расчёт оценки вакансии.
 * Чистые функции без DOM: работают и в браузере (globalThis.RVScore), и в Node (тесты).
 * Данные — внутренние поля фронтенда hh.ru (HH-Lux-InitialState и ответы при листании).
 * Документации у hh на них нет, поэтому всё читается осторожно: нет поля — нет фактора.
 */
(function (root) {
  'use strict';

  const DAY = 864e5;
  const BASE = 50;
  // Грубый перевод «до вычета налогов» в «на руки»: НДФЛ 13 %.
  const NET_FACTOR = 0.87;

  function plural(n, one, few, many) {
    const a = Math.abs(Math.trunc(n)) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function fmtInt(n) {
    return Math.round(n).toLocaleString('ru-RU');
  }

  // Даты у hh бывают строкой ISO, объектом {"@timestamp": сек, "$": ISO} или числом.
  function toTime(x) {
    if (x == null) return null;
    if (typeof x === 'number') return x < 1e12 ? x * 1000 : x;
    if (typeof x === 'object') {
      if (typeof x.$ === 'string') return toTime(x.$);
      if (typeof x['@timestamp'] === 'number') return x['@timestamp'] * 1000;
      return null;
    }
    const t = Date.parse(x);
    return Number.isNaN(t) ? null : t;
  }

  function median(nums) {
    const a = nums.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function hasSalary(c) {
    return !!c && !c.noCompensation && !!(c.from || c.to || c.perModeFrom || c.perModeTo);
  }

  // Месячная зарплата на руки в рублях или null, если сравнивать нельзя.
  function monthlyNet(c) {
    if (!hasSalary(c) || c.currencyCode !== 'RUR') return null;
    if (c.mode && c.mode !== 'MONTH') return null;
    const from = c.perModeFrom ?? c.from;
    const to = c.perModeTo ?? c.to;
    let v = from && to ? (from + to) / 2 : from || to;
    if (!v) return null;
    if (c.gross) v *= NET_FACTOR;
    return v;
  }

  function responses(v) {
    if (typeof v.totalResponsesCount === 'number') return v.totalResponsesCount;
    if (typeof v.responsesCount === 'number') return v.responsesCount;
    return null;
  }

  function pageStats(list) {
    const salaries = list.map((v) => monthlyNet(v.compensation)).filter((x) => x != null);
    return {
      count: list.length,
      medianResponses: median(list.map(responses)),
      // Медиану зарплат считаем, только если есть хотя бы 5 сравнимых зарплат.
      medianSalary: salaries.length >= 5 ? median(salaries) : null,
    };
  }

  function ageText(days) {
    if (days < 1) return 'сегодня';
    if (days < 2) return 'вчера';
    const n = Math.floor(days);
    return `${n} ${plural(n, 'день', 'дня', 'дней')} назад`;
  }

  function levelOf(score) {
    if (score >= 75) return 'high';
    if (score >= 45) return 'mid';
    return 'low';
  }

  const LEVEL_TEXT = { high: 'хорошие шансы', mid: 'средние шансы', low: 'слабые шансы' };

  // Факторы, вес которых может менять пользователь: 0 — не учитывать, 1 — как есть, 2 — вдвое важнее.
  const WEIGHTS = [
    ['competition', 'Конкуренция (отклики)'],
    ['freshness', 'Свежесть вакансии'],
    ['salary', 'Зарплата'],
    ['reply', 'Скорость ответа'],
    ['online', 'Рекрутер онлайн'],
    ['test', 'Тестовое задание'],
    ['letter', 'Сопроводительное письмо'],
  ];

  function weightOf(weights, key) {
    const w = weights && weights[key];
    return typeof w === 'number' && Number.isFinite(w) ? Math.max(0, Math.min(2, w)) : 1;
  }

  function analyze(v, stats = {}, now = Date.now(), weights = null) {
    const factors = [];
    const chips = [];
    const flags = { zombie: false, test: false, letter: false, online: false, hasSalary: false };

    const created = toTime(v.creationTime);
    const published = toTime(v.publicationTime) ?? created;
    const ageDays = created != null ? Math.max(0, (now - created) / DAY) : null;
    flags.ageDays = ageDays == null ? null : Math.floor(ageDays);

    // 1. Конкуренция: сколько уже откликнулось.
    const total = responses(v);
    flags.responses = total;
    if (total != null) {
      const perDay = total / Math.max(ageDays ?? 1, 1);
      const pts = total <= 20 ? 14 : total <= 50 ? 8 : total <= 100 ? 2 : total <= 250 ? -6 : total <= 500 ? -12 : -20;
      const head = `${fmtInt(total)} ${plural(total, 'отклик', 'отклика', 'откликов')}`;
      const per = ageDays != null && ageDays < 1 ? 'за первые сутки' : perDay >= 1 ? `≈${fmtInt(perDay)} в день` : 'меньше 1 в день';
      let rel = '';
      const med = stats.medianResponses;
      if (med) rel = total > med * 1.25 ? ' — больше медианы выдачи' : total < med * 0.75 ? ' — меньше медианы выдачи' : ' — около медианы выдачи';
      factors.push({ key: 'competition', title: 'Конкуренция', detail: `${head}, ${per}${rel}`, points: pts });
      chips.push({ key: 'competition', text: `${head} · ${per}`, tone: total <= 50 ? 'good' : total <= 250 ? 'warn' : 'bad' });
    }

    // 2. Свежесть и зомби-вакансии: давно висит и её переподнимают.
    if (ageDays != null) {
      const bumped = published != null && published - created > DAY;
      const zombie = ageDays > 30 && bumped;
      flags.zombie = zombie;
      let pts = ageDays <= 3 ? 12 : ageDays <= 7 ? 8 : ageDays <= 14 ? 3 : ageDays <= 30 ? 0 : ageDays <= 60 ? -8 : -14;
      if (zombie) pts -= 4;
      const createdText = `Создана ${ageText(ageDays)}`;
      factors.push({
        key: 'freshness',
        title: zombie ? 'Зомби-вакансия' : 'Свежесть',
        detail: `${createdText}, ${bumped ? 'переподнималась' : 'не переподнималась'}`,
        points: pts,
      });
      if (zombie) {
        const d = Math.floor(ageDays);
        chips.push({ key: 'freshness', text: `Висит ${d} ${plural(d, 'день', 'дня', 'дней')}, переподнята`, tone: 'bad' });
      } else {
        chips.push({ key: 'freshness', text: createdText, tone: ageDays <= 7 ? 'good' : ageDays <= 30 ? 'warn' : 'bad' });
      }
    }

    // 3. Скорость ответа работодателя — метка самого hh.
    const labels = [].concat(v.labels || [], v.extraLabels || []);
    const speed = labels.find((l) => l && typeof l.id === 'string' && l.id.includes('employer-reply-speed'));
    if (speed) {
      const pts = /withinOneDay/i.test(speed.id) ? 8 : /withinThreeDays/i.test(speed.id) ? 6 : 3;
      const text = speed.text || 'Быстро отвечает';
      factors.push({ key: 'reply', title: 'Скорость ответа', detail: `По метке hh: «${text}»`, points: pts });
      chips.push({ key: 'reply', text, tone: 'good' });
    }

    // 4. Рекрутер в сети прямо сейчас.
    const act = v.employerManager && v.employerManager.latestActivity;
    flags.online = !!act && act !== 'offline';
    if (flags.online) {
      factors.push({ key: 'online', title: 'Рекрутер', detail: 'Сейчас в сети', points: 4 });
      chips.push({ key: 'online', text: 'Рекрутер онлайн', tone: 'good' });
    }

    // 5. Зарплата: указана ли и как относится к медиане выдачи.
    flags.hasSalary = hasSalary(v.compensation);
    const net = monthlyNet(v.compensation);
    if (!flags.hasSalary) {
      factors.push({ key: 'salary', title: 'Зарплата', detail: 'Не указана', points: -4 });
      chips.push({ key: 'salary', text: 'Зарплата не указана', tone: 'neutral' });
    } else if (net != null && stats.medianSalary) {
      const ratio = net / stats.medianSalary;
      const base = `≈${fmtInt(net)} ₽ на руки`;
      if (ratio >= 1.15) {
        factors.push({ key: 'salary', title: 'Зарплата', detail: `${base} — выше медианы выдачи`, points: 8 });
        chips.push({ key: 'salary', text: 'Зарплата выше медианы', tone: 'good' });
      } else if (ratio <= 0.85) {
        factors.push({ key: 'salary', title: 'Зарплата', detail: `${base} — ниже медианы выдачи`, points: 0 });
        chips.push({ key: 'salary', text: 'Зарплата ниже медианы', tone: 'warn' });
      } else {
        factors.push({ key: 'salary', title: 'Зарплата', detail: `${base} — на уровне медианы выдачи`, points: 4 });
      }
    } else {
      factors.push({ key: 'salary', title: 'Зарплата', detail: 'Указана', points: 4 });
    }

    // 6. Тестовое задание до отклика.
    if (v.userTestPresent) {
      flags.test = true;
      factors.push({ key: 'test', title: 'Тестовое задание', detail: 'Нужно пройти до отклика', points: -6 });
      chips.push({ key: 'test', text: 'Тестовое задание', tone: 'warn' });
    }

    // 7. Обязательное сопроводительное письмо.
    if (v['@responseLetterRequired']) {
      flags.letter = true;
      factors.push({ key: 'letter', title: 'Сопроводительное письмо', detail: 'Обязательно — отклик займёт дольше', points: -2 });
      chips.push({ key: 'letter', text: 'Нужно сопроводительное письмо', tone: 'neutral' });
    }

    for (const f of factors) f.points = Math.round(f.points * weightOf(weights, f.key)) || 0;
    const sum = factors.reduce((s, f) => s + f.points, 0);
    const score = Math.max(0, Math.min(100, Math.round(BASE + sum)));
    const level = levelOf(score);
    return { id: String(v.vacancyId), score, level, levelText: LEVEL_TEXT[level], factors, chips: chips.slice(0, 5), flags };
  }

  const LIMIT_DEFAULT = 100;
  // Порог «до N откликов»: целое от 1 до 10 000, иначе значение по умолчанию.
  function responsesLimit(s) {
    const n = Math.round(Number(s && s.responsesLimit));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 10000) : LIMIT_DEFAULT;
  }

  // Причина скрыть вакансию по включённым фильтрам или null.
  function hiddenReason(a, s) {
    const f = a.flags;
    const limit = responsesLimit(s);
    if (s.hideZombie && f.zombie) return `зомби-вакансия, висит ${f.ageDays} ${plural(f.ageDays, 'день', 'дня', 'дней')}`;
    if (s.maxResponses && f.responses != null && f.responses > limit) return `${fmtInt(f.responses)} ${plural(f.responses, 'отклик', 'отклика', 'откликов')} — больше ${fmtInt(limit)}`;
    if (s.onlySalary && !f.hasSalary) return 'зарплата не указана';
    if (s.noTest && f.test) return 'есть тестовое задание';
    if (s.onlineOnly && !f.online) return 'рекрутер не в сети';
    return null;
  }

  // Находит в любом JSON все массивы вакансий (объекты с полем vacancyId).
  function collectVacancies(obj) {
    const out = [];
    const seen = new Set();
    (function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 12 || seen.has(o)) return;
      seen.add(o);
      if (Array.isArray(o)) {
        if (o.length && o[0] && typeof o[0] === 'object' && 'vacancyId' in o[0]) {
          for (const v of o) if (v && v.vacancyId != null) out.push(v);
          return;
        }
        for (const x of o) walk(x, depth + 1);
        return;
      }
      for (const k of Object.keys(o)) walk(o[k], depth + 1);
    })(obj, 0);
    return out;
  }

  const api = { analyze, pageStats, hiddenReason, collectVacancies, monthlyNet, median, plural, toTime, fmtInt, levelOf, BASE, WEIGHTS, responsesLimit, LIMIT_DEFAULT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RVScore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
