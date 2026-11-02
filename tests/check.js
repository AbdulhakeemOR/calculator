"use strict";

// Browser-only checks. Each frame uses isolated storage and controlled rate/audio data.
const setup = () => {
  const storage = new Map();
  Object.defineProperty(window, 'localStorage', { value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value))
  } });
  for (const mode of ['simple', 'scientific', 'expanded', 'exchange']) {
    storage.set(`calculator-history-${mode}`, JSON.stringify([`${mode}: 1+1 = 2`]));
  }
  storage.set('calculator-history', JSON.stringify(['Legacy mixed history']));
  window.checkState = { requests: 0, sounds: 0, mode: 'success', errors: [] };
  window.addEventListener('error', event => checkState.errors.push(event.message));
  const now = Math.floor(Date.now() / 1000);
  window.fetch = async () => {
    checkState.requests++;
    if (checkState.mode === 'offline') throw new Error('Offline');
    return { ok: true, json: async () => checkState.mode === 'invalid' ? {} : {
      result: 'success', base_code: 'USD', time_last_update_unix: now - 60,
      time_next_update_unix: now + 86400, rates: { USD: 1, EUR: 0.8, SAR: 4, NGN: 1600, JPY: 150 }
    } };
  };
  window.AudioContext = class {
    state = 'running'; currentTime = 0; destination = {};
    createOscillator() {
      checkState.sounds++;
      return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {}, disconnect() {} };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    }
  };
};

const results = document.querySelector('#results');
const frame = document.querySelector('#preview');
const lines = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 30));

async function checkPage(filename) {
  const response = await fetch(`../${filename}`);
  if (!response.ok) throw new Error(`Cannot read ${filename}`);
  let source = await response.text();
  // Resolve styles/scripts against the project, and install substitutes before deferred app code.
  const base = new URL('../', location.href).href;
  source = source.replace('<head>', `<head><base href="${base}"><script>(${setup.toString()})();<\/script>`);
  await new Promise(resolve => {
    frame.onload = resolve;
    frame.srcdoc = source;
  });
  await tick();
  const win = frame.contentWindow;
  const doc = win.document;
  const mode = ({'index.html':'simple', 'complex.html':'scientific', 'expand.html':'expanded', 'exchange.html':'exchange'})[filename];
  const initialHistory = doc.querySelector('#history-list').textContent;
  assert(initialHistory === `${mode}: 1+1 = 2`, 'Only current mode history loaded');
  const key = value => doc.querySelector(`[data-key="${value}"]`).click();
  const ratio = (first, second) => {
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        value /= 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const a = luminance(first), b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  for (const theme of ['light', 'dark']) {
    doc.documentElement.dataset.theme = theme;
    for (const name of ['--page', '--panel', '--ink', '--screen', '--key', '--accent', '--line']) {
      assert(win.getComputedStyle(doc.documentElement).getPropertyValue(name).trim(), `${theme}: ${name} missing`);
    }
    for (const element of doc.querySelectorAll('.key, .calculator__display, .calculator__settings-toggle, select')) {
      const style = win.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      assert(bounds.width > 0 && bounds.height > 0, `${theme}: invisible control`);
      assert(style.backgroundColor !== 'rgba(0, 0, 0, 0)', `${theme}: transparent control background`);
      assert(ratio(style.color, style.backgroundColor) >= 4.5, `${theme}: insufficient control contrast`);
    }
  }
  doc.documentElement.dataset.theme = 'light';
  doc.querySelector('[data-setting="theme"]').click();
  assert(doc.documentElement.dataset.theme === 'dark', 'Theme toggle');
  assert(win.localStorage.getItem('calculator-theme') === 'dark', 'Saved theme');
  key('2'); key('+'); key('3'); key('=');
  const calculatorDisplay = doc.querySelector('.calculator__display');
  assert(calculatorDisplay ? calculatorDisplay.value === '2+3' && doc.querySelector('#result').textContent === '= 5' : doc.querySelector('#from-amount').textContent === '5.00', 'Arithmetic');
  assert(win.evaluateExpression('2+3*4') === 14, 'Precedence');
  assert(win.evaluateExpression('2^3^2') === 512, 'Powers');
  assert(win.evaluateExpression('(-8)@3') === -2, 'Odd root');
  let rejected = false;
  try { win.evaluateExpression('1/0'); } catch { rejected = true; }
  assert(rejected, 'Division by zero');
  assert(win.checkState.sounds > 0, 'Button sound');
  const sound = doc.querySelector('[data-setting="sound"]');
  sound.click();
  const count = win.checkState.sounds;
  key('AC');
  assert(win.checkState.sounds === count && sound.getAttribute('aria-pressed') === 'false', 'Mute');
  assert(win.localStorage.getItem('calculator-sound') === 'off', 'Saved sound preference');
  sound.click();
  assert(win.checkState.sounds === count + 1, 'Unmute preview');
  if (calculatorDisplay) {
    const editor = doc.querySelector('#expression');
    editor.value = '12+34*2'; editor.dispatchEvent(new win.Event('input'));
    assert(calculatorDisplay.value === '12+34*2', 'Live expression');
    editor.value = '12+35*2'; editor.dispatchEvent(new win.Event('input'));
    editor.dispatchEvent(new win.KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    assert(calculatorDisplay.value === '12+35*2', 'Equation retained after calculation');
    assert(doc.querySelector('#result').textContent === '= 82', 'Answer inside display');
    editor.value = '12+36*2'; editor.dispatchEvent(new win.Event('input'));
    assert(doc.querySelector('#result').textContent === '', 'Stale answer cleared during editing');
    editor.dispatchEvent(new win.KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    assert(editor.value === '12+36*2' && doc.querySelector('#result').textContent === '= 84', 'Edit equation after calculation');
    assert(doc.querySelector('.calculator__screen').contains(editor), 'Single editable display');
    assert(doc.querySelector('#status').textContent === '', 'Equation is not below display');
    assert(doc.querySelector('.history').open, 'History visible');
    doc.querySelector('#history-list button').click();
    assert(editor.value === '12+36*2', 'Restore editable history');
    key('AC');
  }
  if (filename === 'complex.html') {
    key('9'); key('sqrt'); key('=');
    assert(doc.querySelector('#result').textContent === '= 3', 'Square root');
    key('AC'); key('3'); key('0'); key('sin'); key('=');
    assert(Math.abs(Number(doc.querySelector('#result').textContent.slice(2)) - 0.5) < 1e-12, 'Degree sine');
  }
  if (filename === 'exchange.html') {
    const from = doc.querySelector('#from-currency'), to = doc.querySelector('#to-currency');
    assert(!doc.querySelector('.calculator__display'), 'Exchange calculator display removed');
    assert(from.options.length === 5 && to.options.length === 5, 'Provider currencies');
    assert(!/^[A-Z]{3}\s*-/.test(from.selectedOptions[0].textContent), 'Currency code replaced by selected flag');
    assert(doc.querySelector('#from-flag img').src.endsWith('/sa.png') && doc.querySelector('#to-flag img').src.endsWith('/ng.png'), 'Selected currency flags');
    key('2');
    assert(doc.querySelector('#conversion').textContent.startsWith('800.00 NGN'), 'SAR/NGN');
    assert(doc.querySelector('#from-amount').textContent === '2.00' && doc.querySelector('#to-amount').textContent === '800.00', 'Amounts shown in currency controls');
    from.value = 'EUR'; to.value = 'JPY'; from.dispatchEvent(new win.Event('change'));
    assert(doc.querySelector('#conversion').textContent.startsWith('375 JPY'), 'Cross currency');
    assert(doc.querySelector('#from-flag img').src.endsWith('/eu.png') && doc.querySelector('#to-flag img').src.endsWith('/jp.png'), 'Flags update with selection');
    from.value = 'USD'; to.value = 'NGN';
    key('AC');
    for (const digit of '1110.68294375') key(digit);
    assert(doc.querySelector('#to-amount').textContent === '1,777,092.71', 'Grouped currency with two decimals');
    from.value = 'EUR'; to.value = 'JPY';
    key('swap');
    assert(from.value === 'JPY' && to.value === 'EUR', 'Swap');
    assert(win.checkState.requests === 1, 'No repeated requests on input');
    for (const mode of ['offline', 'invalid']) {
      win.checkState.mode = mode;
      doc.querySelector('#refresh-rates').click(); await tick();
      assert(doc.querySelector('#rate-status').textContent.includes('Using saved rates'), `${mode} fallback`);
    }
    win.checkState.mode = 'success';
    doc.querySelector('#refresh-rates').click(); await tick();
    assert(!doc.querySelector('#rate-status').textContent.includes('Unable'), 'Rate recovery');
  }
  assert(JSON.parse(win.localStorage.getItem(`calculator-history-${mode}`))[0].includes(' = '), 'Current mode history saved');
  const otherMode = mode === 'simple' ? 'scientific' : 'simple';
  const otherHistory = win.localStorage.getItem(`calculator-history-${otherMode}`);
  doc.querySelector('[data-setting="history"]').click();
  assert(doc.querySelector('#history-list').children.length === 0, 'Current history cleared');
  assert(win.localStorage.getItem(`calculator-history-${mode}`) === '[]', 'Current history deletion saved');
  assert(win.localStorage.getItem(`calculator-history-${otherMode}`) === otherHistory, 'Other mode history preserved');
  assert(win.localStorage.getItem('calculator-history').includes('Legacy mixed history'), 'Legacy history preserved separately');
  assert(win.checkState.errors.length === 0, win.checkState.errors.join(', '));
  // Also catch horizontal overflow at a common small phone width.
  frame.width = '320';
  await tick();
  assert(doc.documentElement.scrollWidth <= doc.documentElement.clientWidth, 'Phone layout overflows');
  frame.width = '840';
  lines.push(`PASS ${filename}: both themes, contrast, phone layout, calculations, settings${filename === 'exchange.html' ? ', exchange and offline fallback' : ''}`);
  results.textContent = lines.join('\n');
}

(async () => {
  try {
    for (const page of ['index.html', 'complex.html', 'exchange.html', 'expand.html']) await checkPage(page);
    results.textContent += '\nALL CHECKS PASSED';
    document.title = 'PASS - Calculator checks';
  } catch (error) {
    results.textContent = lines.concat(`FAIL: ${error.message}`).join('\n');
    document.title = 'FAIL - Calculator checks';
  }
})();
