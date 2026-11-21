/* Окно настроек по клику на значок расширения. Пишет в тот же rvSettings, что и панель на странице. */
(function () {
  'use strict';
  const S = globalThis.RVScore;
  const DEFAULTS = { hideZombie: true, maxResponses: false, onlySalary: false, noTest: false, onlineOnly: false, sort: 'score', weights: {}, responsesLimit: 100, siteTheme: 'site', hideAds: true };
  const FILTERS = [
    ['hideZombie', 'Зомби-вакансии (старые и переподнятые)'],
    ['maxResponses', 'Больше 100 откликов'],
    ['onlySalary', 'Без указанной зарплаты'],
    ['noTest', 'С тестовым заданием'],
    ['onlineOnly', 'Если рекрутер не в сети'],
  ];
  const W_LABELS = ['не учитывать', 'почти не важно', 'как есть', 'важнее', 'очень важно'];
  const area = chrome.storage.local;

  let settings = { ...DEFAULTS };

  // Тема окна — как у hh в последний раз, когда расширение его видело; иначе — как в системе.
  area.get('rvTheme', (x) => {
    const t = x && x.rvTheme;
    const dark = t ? t === 'night' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  });

  function load(cb) {
    area.get('rvSettings', (x) => {
      settings = { ...DEFAULTS, ...((x && x.rvSettings) || {}) };
      cb();
    });
  }

  // Перед записью перечитываем настройки: панель на странице могла изменить их раньше.
  function save(patch) {
    area.get('rvSettings', (x) => {
      settings = { ...DEFAULTS, ...((x && x.rvSettings) || {}), ...patch };
      area.set({ rvSettings: settings });
    });
  }

  function build() {
    const filters = document.getElementById('filters');
    for (const [key, label] of FILTERS) {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!settings[key];
      input.addEventListener('change', () => save({ [key]: input.checked }));
      const l = document.createElement('label');
      l.className = 'opt';
      if (key === 'maxResponses') {
        // «Больше [100] откликов» — число редактируется, изменение сразу включает фильтр.
        const num = document.createElement('input');
        num.type = 'number'; num.min = '1'; num.max = '10000'; num.step = '10';
        num.className = 'num';
        num.value = String(S.responsesLimit(settings));
        num.setAttribute('aria-label', 'Максимум откликов');
        num.addEventListener('click', (e) => e.preventDefault()); // не переключать галочку кликом по полю
        let last = S.responsesLimit(settings);
        num.addEventListener('change', () => {
          if (!(Number(num.value) >= 1)) { num.value = String(last); return; }
          const n = S.responsesLimit({ responsesLimit: num.value });
          last = n;
          num.value = String(n);
          input.checked = true;
          save({ responsesLimit: n, maxResponses: true });
        });
        l.append(input, 'Больше', num, 'откликов');
      } else {
        l.append(input, label);
      }
      filters.append(l);
    }

    const ads = document.getElementById('hideAds');
    ads.checked = settings.hideAds !== false;
    ads.addEventListener('change', () => save({ hideAds: ads.checked }));

    const theme = document.getElementById('siteTheme');
    theme.value = ['night', 'system'].includes(settings.siteTheme) ? settings.siteTheme : 'site';
    theme.addEventListener('change', () => {
      save({ siteTheme: theme.value });
      // Окно настроек сразу переходит на выбранную тему.
      const dark = theme.value === 'night' || (theme.value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      if (theme.value !== 'site') document.documentElement.classList.toggle('dark', dark);
    });

    const sort = document.getElementById('sort');
    sort.value = settings.sort;
    sort.addEventListener('change', () => save({ sort: sort.value }));

    const weights = document.getElementById('weights');
    const ranges = [];
    for (const [key, label] of S.WEIGHTS) {
      const w = settings.weights && typeof settings.weights[key] === 'number' ? settings.weights[key] : 1;
      const val = document.createElement('span');
      val.className = 'w-val';
      const input = document.createElement('input');
      input.type = 'range'; input.min = '0'; input.max = '4'; input.step = '1';
      input.value = String(Math.round(w * 2));
      input.dataset.key = key;
      val.textContent = W_LABELS[Number(input.value)];
      input.addEventListener('input', () => {
        val.textContent = W_LABELS[Number(input.value)];
        area.get('rvSettings', (x) => {
          const cur = { ...DEFAULTS, ...((x && x.rvSettings) || {}) };
          save({ weights: { ...cur.weights, [key]: Number(input.value) / 2 } });
        });
      });
      const top = document.createElement('div');
      top.className = 'w-top';
      const name = document.createElement('span');
      name.textContent = label;
      top.append(name, val);
      const box = document.createElement('div');
      box.className = 'w';
      box.append(top, input);
      weights.append(box);
      ranges.push([input, val]);
    }
    document.getElementById('reset').addEventListener('click', () => {
      save({ weights: {} });
      for (const [input, val] of ranges) { input.value = '2'; val.textContent = W_LABELS[2]; }
    });
  }

  load(build);
})();
