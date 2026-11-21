/* Окно настроек по клику на значок расширения. Пишет в тот же rvSettings, что и панель на странице. */
(function () {
  'use strict';
  const S = globalThis.RVScore;
  const DEFAULTS = { hideZombie: true, maxResponses: false, onlySalary: false, noTest: false, onlineOnly: false, sort: 'score', weights: {} };
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
      l.append(input, label);
      filters.append(l);
    }

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
