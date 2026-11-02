/* Shared calculator engine: recursive descent, without eval or generated code. */
"use strict";
function evaluateExpression(source) {
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[()+\-*/^@]/gi) || [];
  if (tokens.join('') !== source.replace(/\s/g, '') || !tokens.length) throw new Error('Enter a complete expression.');
  let index = 0;
  const checked = value => {
    if (!Number.isFinite(value)) throw new Error('Result is undefined or too large.');
    return value;
  };
  
  function atom() {
    const token = tokens[index++];
    if (token === '(') {
      const value = sum();
      if (tokens[index++] !== ')') throw new Error('Close the parentheses.');
      return value;
    }
    if (!token || !/^(?:\d|\.)/.test(token)) throw new Error('Enter a number.');
    return checked(Number(token));
  }

  function power() {
    const value = atom();
    if (tokens[index] === '^' || tokens[index] === '@') {
      const operator = tokens[index++];
      const right = unary();
      if (operator === '@' && right === 0) throw new Error('Root degree cannot be zero.');
      return checked(operator === '^' ? value ** right : value < 0 && Number.isInteger(right) && Math.abs(right % 2) === 1 ? -((-value) ** (1 / right)) : value ** (1 / right));
    }
    return value;
  }

  function unary() {
    if (tokens[index] === '+') { index++; return unary(); }
    if (tokens[index] === '-') { index++; return -unary(); }
    return power();
  }

  function product() {
    let value = unary();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const operator = tokens[index++];
      const right = unary();
      if (operator === '/' && right === 0) throw new Error('Cannot divide by zero.');
      value = checked(operator === '*' ? value * right : value / right);
    }
    return value;
  }

  function sum() {
    let value = product();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const operator = tokens[index++];
      const right = product();
      value = checked(operator === '+' ? value + right : value - right);
    }
    return value;
  }

  const result = checked(sum());
  if (index !== tokens.length) throw new Error('Check the expression.');
  return result;
}

if (typeof document !== 'undefined') {
  const calculator = document.querySelector('.calculator');
  const resultDisplay = document.querySelector('#result');
  const expressionLabel = document.querySelector('#expression');
  const status = document.querySelector('#status');
  const menu = document.querySelector('#settings-menu');
  const toggle = document.querySelector('.calculator__settings-toggle');
  const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ } };
  const mode = ['simple', 'scientific', 'expanded', 'exchange'].find(name => calculator.classList.contains(`calculator--${name}`)) || 'simple';
  const historyKey = `calculator-history-${mode}`;
  let expression = '', completed = false, memory = 0, degrees = true, history = [];
  try { const stored = JSON.parse(read(historyKey, '[]')); if (Array.isArray(stored)) history = stored.filter(item => typeof item === 'string').slice(0, 30); } catch { /* Ignore corrupt storage. */ }
  document.documentElement.dataset.theme = read('calculator-theme', 'light');
  let soundEnabled = read('calculator-sound', 'on') === 'on';
  let audioContext;
  const soundButton = document.querySelector('[data-setting="sound"]');
  function renderSoundSetting() {
    soundButton.textContent = `Button sound: ${soundEnabled ? 'On' : 'Off'}`;
    soundButton.setAttribute('aria-pressed', String(soundEnabled));
  }

  async function playButtonSound() {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext ??= new AudioContextClass();
      if (audioContext.state === 'suspended') await audioContext.resume();
      if (!soundEnabled || audioContext.state !== 'running') return;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(650, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.06, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.05);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    } catch { /* Audio support must never interrupt calculations. */ }
  }

  // Capture user clicks so mouse, touch and keyboard-activated buttons all sound once.
  calculator.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button && !button.disabled && button.dataset.setting !== 'sound') void playButtonSound();
  }, true);
  renderSoundSetting();
  const format = value => String(Number(value.toPrecision(14)));
  function renderHistory() {
    document.querySelector('#history-list').replaceChildren(...history.map(item => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = item;
      button.title = 'Edit this calculation';
      button.addEventListener('click', () => {
        expression = item.split(' = ')[0]; completed = false;
        status.textContent = 'Calculation restored. Edit the expression, then calculate.';
        render(); expressionLabel?.focus();
      });
      li.append(button); return li;
    }));
  }

  const fromCurrency = document.querySelector('#from-currency');
  const toCurrency = document.querySelector('#to-currency');
  const fromAmount = document.querySelector('#from-amount');
  const toAmount = document.querySelector('#to-amount');
  const refreshRates = document.querySelector('#refresh-rates');
  const rateStatus = document.querySelector('#rate-status');
  const ratesCacheKey = 'calculator-exchange-rates-v1';
  let exchangeData = null;
  let ratesLoading = false;
  let rateTimer;
  const currencyRegions = {
    AED:'AE', AFN:'AF', ALL:'AL', AMD:'AM', AOA:'AO', ARS:'AR', AUD:'AU', AZN:'AZ', BAM:'BA', BBD:'BB', BDT:'BD', BGN:'BG', BHD:'BH', BIF:'BI', BMD:'BM', BND:'BN', BOB:'BO', BRL:'BR', BSD:'BS', BTN:'BT', BWP:'BW', BYN:'BY', BZD:'BZ', CAD:'CA', CDF:'CD', CHF:'CH', CLP:'CL', CNY:'CN', COP:'CO', CRC:'CR', CUP:'CU', CVE:'CV', CZK:'CZ', DJF:'DJ', DKK:'DK', DOP:'DO', DZD:'DZ', EGP:'EG', ERN:'ER', ETB:'ET', EUR:'EU', FJD:'FJ', GBP:'GB', GEL:'GE', GHS:'GH', GMD:'GM', GNF:'GN', GTQ:'GT', GYD:'GY', HKD:'HK', HNL:'HN', HRK:'HR', HTG:'HT', HUF:'HU', IDR:'ID', ILS:'IL', INR:'IN', IQD:'IQ', IRR:'IR', ISK:'IS', JMD:'JM', JOD:'JO', JPY:'JP', KES:'KE', KGS:'KG', KHR:'KH', KMF:'KM', KRW:'KR', KWD:'KW', KZT:'KZ', LAK:'LA', LBP:'LB', LKR:'LK', LRD:'LR', LYD:'LY', MAD:'MA', MDL:'MD', MGA:'MG', MKD:'MK', MMK:'MM', MNT:'MN', MOP:'MO', MRU:'MR', MUR:'MU', MVR:'MV', MWK:'MW', MXN:'MX', MYR:'MY', MZN:'MZ', NAD:'NA', NGN:'NG', NIO:'NI', NOK:'NO', NPR:'NP', NZD:'NZ', OMR:'OM', PAB:'PA', PEN:'PE', PGK:'PG', PHP:'PH', PKR:'PK', PLN:'PL', PYG:'PY', QAR:'QA', RON:'RO', RSD:'RS', RUB:'RU', RWF:'RW', SAR:'SA', SCR:'SC', SDG:'SD', SEK:'SE', SGD:'SG', SLE:'SL', SOS:'SO', SRD:'SR', SSP:'SS', STN:'ST', SYP:'SY', SZL:'SZ', THB:'TH', TJS:'TJ', TMT:'TM', TND:'TN', TOP:'TO', TRY:'TR', TTD:'TT', TWD:'TW', TZS:'TZ', UAH:'UA', UGX:'UG', USD:'US', UYU:'UY', UZS:'UZ', VES:'VE', VND:'VN', VUV:'VU', WST:'WS', XAF:'CM', XCD:'AG', XOF:'SN', XPF:'PF', YER:'YE', ZAR:'ZA', ZMW:'ZM', ZWL:'ZW'
  };
  function renderCurrencyFlag(element, code) {
    const region = currencyRegions[code];
    if (!region) { element.replaceChildren(); return; }
    const image = document.createElement('img');
    image.src = `https://flagcdn.com/w40/${region.toLowerCase()}.png`;
    image.alt = '';
    image.width = 24;
    image.height = 18;
    element.replaceChildren(image);
  }
  function validRates(data) {
    return data?.result === 'success' && data.base_code === 'USD' &&
      Number.isFinite(data.time_last_update_unix) && data.time_last_update_unix > 0 &&
      Number.isFinite(data.time_next_update_unix) &&
      data.time_next_update_unix > data.time_last_update_unix &&
      data.rates && typeof data.rates === 'object' && !Array.isArray(data.rates) &&
      data.rates.USD === 1 && Object.keys(data.rates).length > 1 &&
      Object.entries(data.rates).every(([code, rate]) => /^[A-Z]{3}$/.test(code) && Number.isFinite(rate) && rate > 0);
  }

  function populateCurrencies() {
    const previousFrom = fromCurrency.value || read('calculator-currency-from', 'SAR');
    const previousTo = toCurrency.value || read('calculator-currency-to', 'NGN');
    const codes = Object.keys(exchangeData.rates).sort();
    let names;
    try { names = new Intl.DisplayNames([navigator.language || 'en'], { type: 'currency' }); } catch { /* Codes are sufficient on older browsers. */ }
    for (const [select, selected, fallback] of [[fromCurrency, previousFrom, 'USD'], [toCurrency, previousTo, 'EUR']]) {
      select.replaceChildren(...codes.map(code => {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = names ? names.of(code) : 'Currency';
        return option;
      }));
      select.value = codes.includes(selected) ? selected : codes.includes(fallback) ? fallback : codes[0];
      select.disabled = false;
    }
    updateCurrencyFlags();
    document.querySelector('#swap-currencies').disabled = false;
  }

  function updateCurrencyFlags() {
    renderCurrencyFlag(document.querySelector('#from-flag'), fromCurrency.value);
    renderCurrencyFlag(document.querySelector('#to-flag'), toCurrency.value);
  }

  function persistCurrencies() {
    save('calculator-currency-from', fromCurrency.value);
    save('calculator-currency-to', toCurrency.value);
  }

  function describeRates(prefix = '') {
    const updated = new Date(exchangeData.time_last_update_unix * 1000).toLocaleString();
    const outdated = Date.now() >= exchangeData.time_next_update_unix * 1000;
    rateStatus.textContent = `${prefix}${outdated ? 'Cached rates may be outdated. ' : ''}Rates updated ${updated}.`;
  }

  function scheduleRateRefresh() {
    clearTimeout(rateTimer);
    if (!exchangeData) return;
    const delay = Math.max(60_000, exchangeData.time_next_update_unix * 1000 - Date.now());
    rateTimer = setTimeout(() => void loadRates(), Math.min(delay, 2_147_483_647));
  }

  async function loadRates() {
    if (!fromCurrency || ratesLoading) return;
    ratesLoading = true;
    refreshRates.disabled = true;
    rateStatus.textContent = exchangeData ? 'Updating exchange rates...' : 'Loading exchange rates...';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      // One USD table supports every currency pair without a request on each selection.
      const response = await fetch('https://open.er-api.com/v6/latest/USD', {
        signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer'
      });
      if (!response.ok) throw new Error('Rate service is unavailable.');
      const data = await response.json();
      if (!validRates(data)) throw new Error('Invalid exchange rate response.');
      exchangeData = data;
      save(ratesCacheKey, JSON.stringify(data));
      populateCurrencies();
      describeRates();
      scheduleRateRefresh();
    } catch {
      if (exchangeData) {
        describeRates('Unable to refresh. Using saved rates. ');
      } else {
        rateStatus.textContent = 'Unable to load rates. Check your internet connection and select Retry.';
        document.querySelector('#conversion').textContent = 'Conversion is unavailable until rates load.';
      }
      clearTimeout(rateTimer);
      rateTimer = setTimeout(() => void loadRates(), 5 * 60_000);
    } finally {
      clearTimeout(timeout);
      ratesLoading = false;
      refreshRates.disabled = false;
      refreshRates.textContent = exchangeData ? 'Refresh rates' : 'Retry';
      convert();
    }
  }

  function formatCurrency(value, currency) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, currencyDisplay: 'code'
    }).formatToParts(value).filter(part => part.type !== 'currency' && part.type !== 'literal').map(part => part.value).join('');
  }

  function convert() {
    if (!fromCurrency) return;
    const output = document.querySelector('#conversion');
    try {
      const amount = evaluateExpression(expression || '0');
      fromAmount.textContent = fromCurrency.value ? formatCurrency(amount, fromCurrency.value) : format(amount);
      if (!exchangeData) return;
      const from = fromCurrency.value;
      const to = toCurrency.value;
      const rate = exchangeData.rates[to] / exchangeData.rates[from];
      const result = amount * rate;
      if (!Number.isFinite(result)) { output.textContent = 'Conversion is too large.'; return; }
      toAmount.textContent = formatCurrency(result, to);
      output.textContent = `${formatCurrency(result, to)} ${to} (1 ${from} = ${format(rate)} ${to})`;
    } catch {
      fromAmount.textContent = expression || '0';
      toAmount.textContent = '—';
      output.textContent = 'Complete the amount to convert.';
    }
  }

  if (fromCurrency) {
    try {
      const cached = JSON.parse(read(ratesCacheKey, 'null'));
      if (validRates(cached)) { exchangeData = cached; populateCurrencies(); describeRates('Saved rates. '); }
    } catch { /* Invalid or unavailable cache is replaced by a fresh request. */ }
    for (const select of [fromCurrency, toCurrency]) {
      select.addEventListener('change', () => { updateCurrencyFlags(); persistCurrencies(); convert(); });
    }
    refreshRates.addEventListener('click', () => void loadRates());
    if (!exchangeData || Date.now() >= exchangeData.time_next_update_unix * 1000) void loadRates();
    else scheduleRateRefresh();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && (!exchangeData || Date.now() >= exchangeData.time_next_update_unix * 1000)) void loadRates();
    });
  }

  function render() {
    if (expressionLabel && expressionLabel.value !== expression) expressionLabel.value = expression;
    if (resultDisplay && !completed) resultDisplay.textContent = '';
    convert();
  }

  expressionLabel?.addEventListener('input', () => {
    expression = expressionLabel.value.replaceAll('\u00d7', '*').replaceAll('\u00f7', '/').replaceAll('\u2212', '-').replaceAll('\u221a', '@');
    completed = false; status.textContent = ''; render();
  });
  expressionLabel?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === '=') {
      event.preventDefault(); void playButtonSound(); act('=');
    } else if (event.key === 'Escape') { event.preventDefault(); act('AC'); }
  });

  function append(value) {
    if (!expressionLabel && completed && !['+', '-', '*', '/', '^', '@'].includes(value)) expression = '';
    completed = false;
    if (expression.length + value.length > 250) throw new Error('Expression is too long.');
    if (value.startsWith('(') && /[\d)]$/.test(expression)) expression += '*';
    if (/^\d|^\./.test(value) && expression.endsWith(')')) expression += '*';
    expression += value;
  }

  // Replace the final operand, preserving the rest of the expression.
  function transform(fn) {
    if (!expression) expression = '0';
    let start;
    if (expression.endsWith(')')) {
      let depth = 0;
      for (let i = expression.length - 1; i >= 0; i--) {
        if (expression[i] === ')') depth++;
        if (expression[i] === '(') depth--;
        if (!depth) { start = i; break; }
      }
    } else {
      const match = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i);
      if (match) start = match.index;
    }
    if (start === undefined) throw new Error('Enter a number first.');
    const value = fn(evaluateExpression(expression.slice(start)));
    if (!Number.isFinite(value)) throw new Error('Function is undefined or too large for this value.');
    expression = expression.slice(0, start) + `(${format(value)})`;
    completed = false;
  }

  function act(key) {
    status.textContent = '';
    try {
      if (/^\d$/.test(key) || ['.', '+', '-', '*', '/', '^', '(', ')'].includes(key)) append(key);
      else if (key === 'AC') { expression = ''; if (expressionLabel) expressionLabel.value = ''; completed = false; }
      else if (key === 'Clear') { expression = expression.slice(0, -1); completed = false; }
      else if (key === '=') {
        const original = expression || '0';
        const result = format(evaluateExpression(original));
        if (resultDisplay) resultDisplay.textContent = `= ${result}`;
        else expression = result;
        completed = true;
        history.unshift(`${original} = ${result}`); history = history.slice(0, 30);
        save(historyKey, JSON.stringify(history)); renderHistory();
      } else if (key === 'mc') { memory = 0; status.textContent = 'Memory cleared.'; }
      else if (key === 'mr') append(`(${format(memory)})`);
      else if (key === 'm+' || key === 'm-') {
        const next = memory + (key === 'm+' ? 1 : -1) * evaluateExpression(expression || '0');
        if (!Number.isFinite(next)) throw new Error('Memory value is too large.');
        memory = next; status.textContent = `Memory: ${format(memory)}`;
      } else if (key === 'angle') {
        degrees = !degrees;
        const button = document.querySelector('[data-key="angle"]');
        button.textContent = degrees ? 'Deg' : 'Rad'; button.setAttribute('aria-label', degrees ? 'Degrees; switch to radians' : 'Radians; switch to degrees');
      } else if (key === 'pi' || key === 'e' || key === 'random') append(`(${key === 'pi' ? Math.PI : key === 'e' ? Math.E : Math.random()})`);
      else if (key === 'EE') {
        if (!/(?:\d+(?:\.\d*)?|\.\d+)$/.test(expression) || /e[+-]?\d*$/i.test(expression)) throw new Error('Enter a mantissa first.');
        append('e');
      } else if (key === 'root') append('@');
      else if (key === 'swap') {
        const from = document.querySelector('#from-currency'), to = document.querySelector('#to-currency');
        [from.value, to.value] = [to.value, from.value];
        updateCurrencyFlags();
        persistCurrencies();
      } else {
        const radians = x => degrees ? x * Math.PI / 180 : x;
        const angle = x => degrees ? x * 180 / Math.PI : x;
        const operations = {
          sign: x => -x, '%': x => x / 100, reciprocal: x => 1 / x,
          square: x => x ** 2, cube: x => x ** 3, sqrt: Math.sqrt,
          pow10: x => 10 ** x, exp: Math.exp, log: Math.log10, ln: Math.log,
          sin: x => Math.sin(radians(x)), cos: x => Math.cos(radians(x)),
          tan: x => { if (Math.abs(Math.cos(radians(x))) < 1e-14) throw new Error('Tangent is undefined at this angle.'); return Math.tan(radians(x)); },
          asin: x => angle(Math.asin(x)), acos: x => angle(Math.acos(x)), atan: x => angle(Math.atan(x)),
          sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
          factorial: x => { if (!Number.isInteger(x) || x < 0 || x > 170) throw new Error('Factorial requires an integer from 0 to 170.'); let value = 1; for (let i = 2; i <= x; i++) value *= i; return value; }
        };
        if (operations[key]) transform(operations[key]);
      }
      render();
    } catch (error) {
      if (resultDisplay) resultDisplay.textContent = '';
      status.textContent = error.message;
    }
  }

  calculator.addEventListener('click', event => {
    const button = event.target.closest('[data-key]');
    if (button) act(button.dataset.key);
  });
  const closeMenu = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', () => { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', event => { if (!event.target.closest('.calculator__settings')) closeMenu(); });
  menu.addEventListener('click', event => {
    const action = event.target.dataset.setting;
    if (action === 'history') { history = []; save(historyKey, '[]'); renderHistory(); status.textContent = 'History for this calculator deleted.'; }
    if (action === 'theme') { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; save('calculator-theme', theme); }
    if (action === 'sound') { soundEnabled = !soundEnabled; save('calculator-sound', soundEnabled ? 'on' : 'off'); renderSoundSetting(); if (soundEnabled) void playButtonSound(); }
    if (action === 'help') document.querySelector('#help').showModal();
    if (action) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { closeMenu(); toggle.focus(); return; }
    if (event.target.closest('input, select, textarea, button, a') || document.querySelector('dialog[open]') || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = ({Enter:'=', '=':'=', Backspace:'Clear', Delete:'AC', Escape:'AC', ',':'.', x:'*'})[event.key] || event.key;
    if (/^[\d.+\-*/^()%]$/.test(key) || ['=', 'Clear', 'AC'].includes(key)) { event.preventDefault(); void playButtonSound(); act(key); }
  });
  renderHistory(); render();
}
