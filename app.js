import { calcDay, sumDays, dayShareOfMonth } from './calc.js';
import { getUsdRate, todayMsk, addDays } from './cbr.js';
import * as store from './store.js';

const $ = s => document.querySelector(s);
const nf = (d) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (v, d = 0) => (Number.isFinite(v) ? nf(d).format(v) : '—');
const pct = (v, d = 2) => fmt(v * 100, d) + '%';
const parseNum = s => { const v = parseFloat(String(s).replace(/[\s ]/g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };
const dmy = iso => iso.split('-').reverse().join('.');

// ---------------- вкладки ----------------
const TITLES = { day: 'День', log: 'Журнал', set: 'Настройки' };
function openTab(name) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  $('#title').textContent = TITLES[name];
  if (name === 'log') renderLog();
  if (name === 'set') renderSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => openTab(b.dataset.tab)));

// ---------------- день ----------------
const st = { date: todayMsk(), cb: null, cbDate: null, cbManual: null, flow: 0, params: null, reqId: 0 };

function effectiveCb() { return st.cbManual ?? st.cb; }

async function loadDate(date) {
  st.date = date;
  $('#date').value = date;
  document.querySelectorAll('[data-shift]').forEach(c => c.classList.toggle('on', addDays(todayMsk(), +c.dataset.shift) === date));
  const saved = store.getDay(date);
  if (saved) {
    Object.assign(st, { cb: saved.cb, cbDate: saved.cbDate, cbManual: saved.cbManual ? saved.cb : null, flow: saved.flow, params: saved.params });
    $('#flow').value = fmt(saved.flow);
    $('#cbManual').value = saved.cbManual ? String(saved.cb).replace('.', ',') : '';
    $('#cbManualBox').classList.toggle('hidden', !saved.cbManual);
    renderCb(); render();
    return;
  }
  Object.assign(st, { cb: null, cbDate: null, cbManual: null, params: null, flow: 0 });
  $('#flow').value = ''; $('#cbManual').value = ''; $('#cbManualBox').classList.add('hidden');
  renderCb('загрузка…'); render();
  const id = ++st.reqId;
  try {
    const r = await getUsdRate(date);
    if (id !== st.reqId) return;
    if (r.notPublished) { renderCb(`На ${dmy(date)} ЦБ ещё не опубликовал курс (обычно ~15:30 МСК). Последний — на ${dmy(r.latestDate)}.`); }
    else { st.cb = r.value; st.cbDate = r.date; renderCb(); }
  } catch (e) {
    if (id !== st.reqId) return;
    renderCb('Нет связи с ЦБ — введите курс вручную');
  }
  render();
}

function renderCb(note) {
  const v = effectiveCb();
  $('#cbValue').textContent = v ? fmt(v, 4) : '—';
  if (note) { $('#cbNote').textContent = note; return; }
  if (st.cbManual != null) $('#cbNote').textContent = 'введён вручную';
  else if (st.cbDate) $('#cbNote').textContent = st.cbDate === st.date ? `ЦБ на ${dmy(st.cbDate)}` : `ЦБ на ${dmy(st.cbDate)} (действует на ${dmy(st.date)})`;
  else $('#cbNote').textContent = '';
}

function row(label, value, cls = '') { return `<tr class="${cls}"><td class="${cls === 'x' ? 'sub' : ''}">${label}</td><td>${value}</td></tr>`; }
function head(label) { return `<tr class="h"><td colspan="2">${label}</td></tr>`; }

function breakdown(r, p) {
  const rub = v => fmt(v) + ' ₽', usd = v => fmt(v) + ' $';
  return [
    head('РФ — ООО'),
    row(`Агентское вознаграждение ${pct(p.agentPct, 1)}`, rub(r.agentRub)),
    row(`НДС ${pct(p.vatPct, 0)} ${p.vatOnTop ? 'сверху' : 'в т.ч.'}`, rub(r.vatRub), 'x'),
    row('Выручка ООО без НДС', rub(r.oooRevenueRub), 'x'),
    row(`Комиссия банка РФ ${pct(p.bankPct, 2)}`, rub(r.bankRub), 'x'),
    row(`ФОТ и налоги на ЗП (1/${Math.round(1 / r.share)} мес.)`, rub(r.payrollRub), 'x'),
    row('База налога на прибыль', rub(r.taxBaseRub), 'x'),
    row(`Налог на прибыль ${pct(p.profitTaxPct, 0)}`, rub(r.profitTaxRub), 'x'),
    row('Остаток ООО (сверка)', rub(r.oooResultRub), 's'),
    head('Гонконг — себес'),
    row('Транзит в ГК', rub(r.transitRub)),
    row(`Комиссия ГК ${pct(r.cost.hkPct, 2)}`, rub(r.cost.hkRub), 'x'),
    row('До конвертации', rub(r.cost.beforeConvRub), 'x'),
    row(`Курс ЦБ +${pct(r.cost.markupPct, 2)}`, fmt(r.cost.convRate, 4), 'x'),
    row('Конвертация', usd(r.cost.usdt), 's'),
    head('Дубай'),
    row(`Номинал + бух/аудит (1/${Math.round(1 / r.share)} мес.)`, usd(r.dubaiUsd)),
    row('К распределению USDT', usd(r.distributableUsdt), 's'),
    row('Внутренний курс структуры', fmt(r.costRate, 4)),
    head('Продажа клиенту'),
    row(`Комиссия ГК ${pct(r.sale.hkPct, 2)}`, rub(r.sale.hkRub), 'x'),
    row(`Курс ЦБ +${pct(r.sale.markupPct, 2)}`, fmt(r.sale.convRate, 4), 'x'),
    row('Выдача клиенту USDT', usd(r.clientUsdt), 's'),
    row('Курс продажи', fmt(r.saleRate, 4)),
    head('Итог'),
    row('Прибыль USDT', usd(r.profitUsdt), 's'),
  ].join('');
}

function render() {
  const cb = effectiveCb();
  const p = st.params || store.getParams();
  const saved = store.getDay(st.date);
  $('#savedNote').textContent = saved
    ? `Сохранено ${new Date(saved.updatedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}${saved.updatedBy ? ' · ' + saved.updatedBy : ''}. Расчёт по настройкам на момент сохранения.`
    : '';
  $('#save').textContent = saved ? 'Пересохранить по текущим настройкам' : 'Сохранить день';
  $('#delete')?.classList.toggle('hidden', !saved);
  if (!cb || !st.flow) { $('#result').classList.add('hidden'); return; }
  const r = calcDay(st.flow, cb, p, dayShareOfMonth(st.date));
  $('#result').classList.remove('hidden');
  $('#rCostRate').textContent = fmt(r.costRate, 2);
  $('#rSaleRate').textContent = fmt(r.saleRate, 2);
  $('#rCostUsdt').textContent = fmt(r.distributableUsdt) + ' ₮';
  $('#rSaleUsdt').textContent = fmt(r.clientUsdt) + ' ₮';
  $('#rProfit').textContent = fmt(r.profitUsdt) + ' ₮';
  $('#rProfit').classList.toggle('neg', r.profitUsdt < 0);
  $('#rProfitPct').textContent = pct(r.profitPct);
  $('#breakdown').innerHTML = breakdown(r, p);
}

$('#date').addEventListener('change', e => e.target.value && loadDate(e.target.value));
document.querySelectorAll('[data-shift]').forEach(c => c.addEventListener('click', () => loadDate(addDays(todayMsk(), +c.dataset.shift))));

$('#flow').addEventListener('input', e => {
  const digits = e.target.value.replace(/\D/g, '');
  st.flow = digits ? parseInt(digits, 10) : 0;
  e.target.value = digits ? fmt(st.flow) : '';
  st.params = null; // при правке считаем по текущим настройкам
  render();
});
$('#cbEdit').addEventListener('click', () => { $('#cbManualBox').classList.remove('hidden'); $('#cbManual').focus(); });
$('#cbManual').addEventListener('input', e => {
  const v = parseNum(e.target.value);
  st.cbManual = v > 0 ? v : null; st.params = null;
  renderCb(); render();
});
$('#cbAuto').addEventListener('click', () => {
  st.cbManual = null; $('#cbManual').value = ''; $('#cbManualBox').classList.add('hidden');
  if (!st.cb) { store.getDay(st.date) ? null : loadDate(st.date); }
  renderCb(); render();
});

$('#save').addEventListener('click', () => {
  const cb = effectiveCb();
  if (!cb || !st.flow) return;
  st.params = store.getParams();
  store.saveDay({ date: st.date, flow: st.flow, cb, cbDate: st.cbManual != null ? null : st.cbDate, cbManual: st.cbManual != null, params: st.params });
  render();
});

// кнопка удаления под «Сохранить»
const del = document.createElement('button');
del.id = 'delete'; del.type = 'button'; del.className = 'link hidden'; del.textContent = 'удалить день';
del.style.cssText = 'display:block;margin:4px auto;color:var(--bad)';
$('#savedNote').after(del);
del.addEventListener('click', () => {
  if (!confirm(`Удалить день ${dmy(st.date)} из журнала у обоих?`)) return;
  store.deleteDay(st.date);
  $('#flow').value = ''; st.flow = 0;
  loadDate(st.date);
});

// ---------------- журнал ----------------
let month = todayMsk().slice(0, 7);
const monthName = m => new Date(m + '-01T00:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
const shiftMonth = (m, n) => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
$('#mPrev').addEventListener('click', () => { month = shiftMonth(month, -1); renderLog(); });
$('#mNext').addEventListener('click', () => { month = shiftMonth(month, 1); renderLog(); });

function renderLog() {
  $('#mLabel').textContent = monthName(month);
  const days = store.listDays().filter(d => d.date.startsWith(month));
  const results = days.map(d => ({ d, r: calcDay(d.flow, d.cb, d.params, dayShareOfMonth(d.date)) }));
  const t = sumDays(results.map(x => x.r));
  $('#monthTotals').innerHTML = days.length ? [
    row('Дней в журнале', t.days),
    row('Поток', fmt(t.flow) + ' ₽'),
    row('К распределению (себес)', fmt(t.distributableUsdt) + ' ₮'),
    row('Выдача клиентам', fmt(t.clientUsdt) + ' ₮'),
    row('Средний курс себеса', fmt(t.costRate, 4)),
    row('Средний курс продажи', fmt(t.saleRate, 4)),
    row('Прибыль USDT', fmt(t.profitUsdt) + ' ₮', 's'),
    row('Остаток ООО', fmt(t.oooResultRub) + ' ₽'),
    row('Налог на прибыль', fmt(t.profitTaxRub) + ' ₽', 'x'),
    row('ФОТ (за дни в журнале)', fmt(t.payrollRub) + ' ₽', 'x'),
    row('Расходы Дубай (за дни в журнале)', fmt(t.dubaiUsd) + ' $', 'x'),
  ].join('') : row('За этот месяц дней нет', '');
  $('#dayList').innerHTML = results.map(({ d, r }) => `
    <div class="card day" data-date="${d.date}">
      <div><div class="d">${dmy(d.date)}</div><div class="muted small">${fmt(d.flow)} ₽ · ЦБ ${fmt(d.cb, 4)}</div>
        <div class="muted small">себес ${fmt(r.costRate, 2)} · продажа ${fmt(r.saleRate, 2)}</div></div>
      <div class="p ${r.profitUsdt < 0 ? 'neg' : ''}">${fmt(r.profitUsdt)} ₮</div>
    </div>`).join('');
  document.querySelectorAll('#dayList .day').forEach(el => el.addEventListener('click', () => { openTab('day'); loadDate(el.dataset.date); }));
}

// ---------------- настройки ----------------
const FIELDS = [
  ['РФ — ООО'],
  ['agentPct', 'Агентское вознаграждение', '%'],
  ['vatPct', 'НДС', '%'],
  ['vatOnTop', 'НДС сверху вознаграждения', 'bool'],
  ['bankPct', 'Комиссия банка РФ', '%'],
  ['payrollMonthRub', 'ФОТ и налоги на ЗП, ₽/мес', 'num'],
  ['profitTaxPct', 'Налог на прибыль', '%'],
  ['Гонконг'],
  ['cost.markupPct', 'Себес: надбавка к ЦБ', '%'],
  ['cost.hkPct', 'Себес: комиссия ГК', '%'],
  ['sale.markupPct', 'Продажа: надбавка к ЦБ', '%'],
  ['sale.hkPct', 'Продажа: комиссия ГК', '%'],
  ['Дубай'],
  ['dubaiNominalUsdMonth', 'Номинал, $/мес', 'num'],
  ['dubaiAccountingUsdMonth', 'Бух, аудит, резерв лицензии, $/мес', 'num'],
];
const getPath = (o, k) => k.split('.').reduce((a, x) => a[x], o);
const setPath = (o, k, v) => { const ks = k.split('.'); const last = ks.pop(); ks.reduce((a, x) => a[x], o)[last] = v; };

function renderSettings() {
  const p = store.getParams();
  let html = '', open = false;
  for (const [k, label, type] of FIELDS) {
    if (!label) { if (open) html += '</fieldset>'; html += `<fieldset><legend>${k}</legend>`; open = true; continue; }
    const v = getPath(p, k);
    if (type === 'bool') html += `<label class="toggle">${label}<input type="checkbox" name="${k}" ${v ? 'checked' : ''}></label>`;
    else html += `<label class="prm"><span>${label}</span><input name="${k}" inputmode="decimal" value="${type === '%' ? fmt(v * 100, 3).replace(/,?0+$/, '') : fmt(v)}"></label>`;
  }
  html += `</fieldset><p class="muted small">ФОТ и расходы Дубая делятся на число дней в месяце и входят в себес каждого дня.
    Сохранённые дни не пересчитываются: у каждого свой снимок курса и настроек.</p>
    <button type="button" id="resetParams" class="link">вернуть значения из финмодели</button>`;
  $('#paramsForm').innerHTML = html;
  $('#resetParams').addEventListener('click', () => { if (confirm('Вернуть все параметры к значениям из финмодели?')) { store.resetParams(); renderSettings(); render(); } });
  renderSyncBox();
}
$('#paramsForm').addEventListener('change', e => {
  const f = FIELDS.find(x => x[0] === e.target.name); if (!f) return;
  const p = store.getParams();
  const v = f[2] === 'bool' ? e.target.checked : f[2] === '%' ? parseNum(e.target.value) / 100 : parseNum(e.target.value);
  setPath(p, f[0], v);
  store.setParams(p);
  render();
});

// ---------------- синхронизация ----------------
function renderSyncBox() {
  const c = store.syncCfg();
  $('#syncLogged').classList.toggle('hidden', !c.refresh);
  $('#loginForm').classList.toggle('hidden', !!c.refresh);
  $('#syncEmail').textContent = c.email || '';
  if (!c.refresh) { $('#loginForm').url.value = c.url || ''; $('#loginForm').key.value = c.anonKey || ''; }
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target; $('#loginErr').textContent = '';
  try { await store.login(f.url.value.trim(), f.key.value.trim(), f.email.value.trim(), f.password.value); f.password.value = ''; renderSyncBox(); }
  catch (err) { $('#loginErr').textContent = err.message; }
});
$('#logoutBtn').addEventListener('click', () => { store.logout(); renderSyncBox(); });
$('#syncNowBtn').addEventListener('click', () => store.syncNow());
$('#sync').addEventListener('click', () => store.syncCfg().refresh ? store.syncNow() : openTab('set'));

store.onChange(s => {
  const b = $('#sync');
  b.className = 'sync' + ({ ok: ' ok', error: ' err', syncing: ' busy' }[s.state] || '');
  $('#syncText').textContent = { off: 'локально', offline: 'офлайн', syncing: 'синхр…', ok: 'синхр ✓', error: 'ошибка' }[s.state];
  b.title = s.message || '';
  if (s.state === 'ok') {
    if (document.querySelector('#tab-log.active')) renderLog();
    if (store.getDay(st.date) && !document.activeElement?.matches('input')) loadDate(st.date);
  }
});

// ---------------- старт ----------------
loadDate(st.date);
store.syncNow();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
