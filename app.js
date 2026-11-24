import { calcDay, monthReport, dayShareOfMonth, clientQuote, rubForUsdt, daysInMonth } from './calc.js';
import { getUsdRate, todayMsk, addDays } from './cbr.js';
import { SUPABASE } from './config.js';
import * as store from './store.js';

const $ = s => document.querySelector(s);
const nf = d => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (v, d = 0) => (Number.isFinite(v) ? nf(d).format(v) : '—');
const pct = (v, d = 2) => fmt(v * 100, d) + '%';
const parseNum = s => { const v = parseFloat(String(s).replace(/[\s ]/g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };
const dmy = iso => iso.split('-').reverse().join('.');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);

// Поле ввода суммы с пробелами между разрядами
function moneyInput(el, onChange, decimals = false) {
  el.addEventListener('input', () => {
    let raw = el.value.replace(/[^\d,.]/g, '').replace('.', ',');
    if (!decimals) raw = raw.replace(/,.*/, '');
    const [i, f] = raw.split(',');
    el.value = i ? fmt(parseInt(i, 10)) + (f !== undefined ? ',' + f.slice(0, 2) : '') : '';
    onChange(parseNum(el.value));
  });
}

// ---------------- вкладки ----------------
const TITLES = { day: 'День', month: 'Месяц', exp: 'Расходы', set: 'Ещё' };
let currentTab = 'day';
function openTab(name) {
  currentTab = name;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  $('#title').textContent = TITLES[name];
  ({ day: renderDay, month: renderMonth, exp: renderExpenses, set: renderSettings })[name]();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => openTab(b.dataset.tab)));

// ---------------- день ----------------
const st = { date: todayMsk(), cb: null, cbDate: null, cbManual: null, cbErr: '', reqId: 0, qMode: 'rub', qVal: 0 };
const effectiveCb = () => st.cbManual ?? st.cb;

async function loadDate(date, refetch = false) {
  st.date = date;
  const saved = store.getDay(date);
  st.cbManual = saved?.cbManual && !refetch ? saved.cb : null;
  st.cb = saved && !saved.cbManual && !refetch ? saved.cb : null;
  st.cbDate = saved?.cbDate ?? null;
  st.cbErr = '';
  renderDay();
  if (st.cb || st.cbManual) return;
  const id = ++st.reqId;
  st.cbErr = 'загрузка…'; renderCb();
  try {
    const r = await getUsdRate(date);
    if (id !== st.reqId) return;
    if (r.notPublished) st.cbErr = `на ${dmy(date)} ещё не опубликован (~15:30 МСК)`;
    else {
      st.cb = r.value; st.cbDate = r.date; st.cbErr = '';
      const sv = store.getDay(date);
      if (refetch && sv) store.saveDay({ ...sv, cb: r.value, cbDate: r.date, cbManual: false });
    }
  } catch { if (id === st.reqId) st.cbErr = 'нет связи с ЦБ — нажмите, чтобы ввести'; }
  if (id === st.reqId) renderDay();
}

function renderCb() {
  const v = effectiveCb();
  $('#cbValue').textContent = v ? `ЦБ ${fmt(v, 4)}` : 'ЦБ —';
  $('#cbNote').textContent = st.cbErr || (st.cbManual != null ? 'вручную' : st.cbDate && st.cbDate !== st.date ? `от ${dmy(st.cbDate)}` : '');
}

function renderQuote() {
  const cb = effectiveCb(), p = store.getParams();
  const rub = st.qMode === 'rub';
  $('#qLabel').textContent = rub ? 'Клиент платит, ₽' : 'Клиент хочет получить, USDT';
  $('#qCur').textContent = rub ? '₽' : '₮';
  if (!cb || !st.qVal) { $('#qOut').textContent = rub ? '→ 0 ₮' : '→ 0 ₽'; $('#qRate').textContent = ''; $('#qAdd').disabled = true; return; }
  const usdt = rub ? clientQuote(st.qVal, cb, p) : st.qVal;
  const rubSum = rub ? st.qVal : rubForUsdt(st.qVal, cb, p);
  $('#qOut').textContent = rub ? `→ ${fmt(usdt, 2)} ₮` : `→ ${fmt(Math.ceil(rubSum))} ₽`;
  $('#qRate').textContent = `по курсу ${fmt(rubSum / usdt, 2)} ₽ за USDT`;
  $('#qAdd').disabled = false;
}

function dayFlow(day) { return (day?.ops || []).reduce((s, o) => s + o.amount, 0); }

function renderDay() {
  const d = new Date(st.date + 'T00:00:00');
  const today = todayMsk();
  const rel = st.date === today ? 'Сегодня' : st.date === addDays(today, 1) ? 'Завтра' : st.date === addDays(today, -1) ? 'Вчера' : '';
  $('#dLabel').innerHTML = `${rel ? `<b>${rel}</b> · ` : ''}${d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })}`;
  $('#date').value = st.date;
  renderCb(); renderQuote();

  const saved = store.getDay(st.date);
  const cb = saved?.cb || effectiveCb();
  const flow = dayFlow(saved);
  const p = saved?.params || store.getParams();
  const r = cb && flow ? calcDay(flow, cb, p, dayShareOfMonth(st.date)) : null;

  $('#sFlow').textContent = fmt(flow) + ' ₽';
  $('#sOps').textContent = saved?.ops.length ? `${saved.ops.length} поступл.` : 'пока пусто';
  $('#sProfit').textContent = r ? fmt(r.profitUsdt) + ' ₮' : '0 ₮';
  $('#sProfit').classList.toggle('bad', !!r && r.profitUsdt < 0);
  $('#sProfitPct').textContent = r ? pct(r.profitPct) + ' от потока' : '';
  // курсы показываем и на пустом дне — для котировок
  const rr = r || (effectiveCb() ? calcDay(1e7, effectiveCb(), store.getParams(), dayShareOfMonth(st.date)) : null);
  $('#sCost').textContent = r ? fmt(r.costRate, 2) : '—';
  $('#sSale').textContent = rr ? fmt(rr.saleRate, 2) : '—';
  $('#sClient').textContent = r ? fmt(r.clientUsdt) + ' ₮' : '—';

  $('#ops').innerHTML = saved?.ops.length ? `<div class="card ops">${[...saved.ops].reverse().map(o => `
    <div class="op"><div><b>${fmt(o.amount)} ₽</b><span class="muted small"> → ${fmt(clientQuote(o.amount, cb, p), 2)} ₮</span>
      <div class="muted small">${o.at ? new Date(o.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}${o.by ? ' · ' + esc(o.by) : ''}</div></div>
      <button type="button" class="x" data-op="${o.id}" aria-label="Удалить">×</button></div>`).join('')}</div>` : '';
  document.querySelectorAll('[data-op]').forEach(b => b.addEventListener('click', () => removeOp(b.dataset.op)));

  $('#chainBox').classList.toggle('hidden', !r);
  if (r) $('#chain').innerHTML = chain(r, p);
}

function chain(r, p) {
  const ru = r.flow;
  const bar = v => `<div class="bar"><i style="width:${Math.max(0.5, Math.min(100, (v / ru) * 100))}%"></i></div>`;
  const step = (title, rows, total, totalLabel) => `<div class="step"><div class="stitle">${title}</div>${rows.map(([l, v]) => `<div class="srow"><span>${l}</span><span>${v}</span></div>`).join('')}
    ${total ? `<div class="srow tot"><span>${totalLabel}</span><span>${total}</span></div>` : ''}</div>`;
  const rub = v => fmt(v) + ' ₽', usd = v => fmt(v) + ' $';
  const ruFixed = p.expenses.filter(e => e.level === 'ru' && e.period === 'month' && +e.amount);
  const aeFixed = p.expenses.filter(e => e.level === 'ae' && e.period === 'month' && +e.amount);
  const sh = r.share;
  return [
    step('🇷🇺 ООО', [
      [`Удержано агентское ${pct(p.agentPct, 1)}`, rub(r.agentRub)],
      [`· НДС ${pct(p.vatPct, 0)} ${p.vatOnTop ? 'сверху' : 'внутри'}`, rub(r.vatRub)],
      [`· Банк РФ ${pct(p.bankPct)}`, rub(r.bankRub)],
      ...ruFixed.map(e => [`· ${esc(e.name)} (за день)`, rub(e.amount * sh)]),
      [`· Налог на прибыль ${pct(p.profitTaxPct, 0)}`, rub(r.profitTaxRub)],
    ], rub(r.oooResultRub), 'Остаток ООО'),
    bar(r.transitRub),
    step('🇭🇰 Гонконг', [
      ['Пришло в ГК', rub(r.transitRub)],
      [`Комиссия ${pct(r.cost.hkPct)}`, rub(r.cost.hkRub)],
      [`Конвертация по ${fmt(r.cost.convRate, 4)} (ЦБ +${pct(r.cost.markupPct)})`, usd(r.cost.usdt)],
    ]),
    step('🇦🇪 Дубай', [
      ...aeFixed.map(e => [`· ${esc(e.name)} (за день)`, usd(e.amount * sh)]),
    ], usd(r.distributableUsdt), `К распределению · себес ${fmt(r.costRate, 2)}`),
    step('👤 Клиенту', [
      [`ГК ${pct(r.sale.hkPct)}, ЦБ +${pct(r.sale.markupPct)} → ${fmt(r.sale.convRate, 4)}`, ''],
    ], usd(r.clientUsdt), `Выдача · курс ${fmt(r.saleRate, 2)}`),
    `<div class="step"><div class="srow tot good"><span>Прибыль</span><span>${fmt(r.profitUsdt)} ₮</span></div></div>`,
  ].join('');
}

function addOp(amount) {
  const cb = effectiveCb();
  if (!cb || !amount) return;
  const saved = store.getDay(st.date);
  const ops = [...(saved?.ops || []), { id: uid(), amount: Math.round(amount), at: new Date().toISOString(), by: store.syncCfg().email || '' }];
  // снимок курса и параметров на момент последнего изменения дня
  store.saveDay({ date: st.date, ops, flow: ops.reduce((s, o) => s + o.amount, 0), cb, cbDate: st.cbManual != null ? null : st.cbDate, cbManual: st.cbManual != null, params: store.getParams() });
  st.qVal = 0; $('#qIn').value = '';
  renderDay();
}
function removeOp(id) {
  const saved = store.getDay(st.date);
  const op = saved.ops.find(o => o.id === id);
  if (!confirm(`Удалить поступление ${fmt(op.amount)} ₽?`)) return;
  const ops = saved.ops.filter(o => o.id !== id);
  if (!ops.length) store.deleteDay(st.date);
  else store.saveDay({ ...saved, ops, flow: ops.reduce((s, o) => s + o.amount, 0) });
  renderDay();
}

moneyInput($('#qIn'), v => { st.qVal = v; renderQuote(); }, true);
$('#qSwap').addEventListener('click', () => { st.qMode = st.qMode === 'rub' ? 'usdt' : 'rub'; st.qVal = 0; $('#qIn').value = ''; renderQuote(); $('#qIn').focus(); });
$('#qAdd').addEventListener('click', () => {
  const cb = effectiveCb();
  addOp(st.qMode === 'rub' ? st.qVal : Math.ceil(rubForUsdt(st.qVal, cb, store.getParams())));
});
$('#qIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('#qAdd').click(); });
$('#dPrev').addEventListener('click', () => loadDate(addDays(st.date, -1)));
$('#dNext').addEventListener('click', () => loadDate(addDays(st.date, 1)));
$('#date').addEventListener('change', e => e.target.value && loadDate(e.target.value));
$('#cbPill').addEventListener('click', () => {
  const v = prompt('Курс ЦБ вручную, ₽/USD (пусто — вернуть курс ЦБ)', effectiveCb() ? String(effectiveCb()).replace('.', ',') : '');
  if (v === null) return;
  const n = parseNum(v);
  st.cbManual = n > 0 ? n : null;
  const saved = store.getDay(st.date);
  if (saved && n > 0) store.saveDay({ ...saved, cb: n, cbManual: true, cbDate: null });
  if (!st.cbManual) loadDate(st.date, true);
  else renderDay();
});

// ---------------- месяц ----------------
let month = todayMsk().slice(0, 7);
const monthName = m => new Date(m + '-01T00:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
const shiftMonth = (m, n) => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
$('#mPrev').addEventListener('click', () => { month = shiftMonth(month, -1); renderMonth(); });
$('#mNext').addEventListener('click', () => { month = shiftMonth(month, 1); renderMonth(); });

function renderMonth() {
  $('#mLabel').innerHTML = `<b>${monthName(month)}</b>`;
  const days = store.listDays().filter(d => d.date.startsWith(month)).map(d => ({ ...d, flow: d.flow ?? dayFlow(d) })).filter(d => d.flow > 0);
  const p = store.getParams();
  const m = monthReport(days, p, month);
  const rub = v => fmt(v) + ' ₽', usd = v => fmt(v) + ' ₮';
  const line = (l, v, cls = '') => `<div class="srow ${cls}"><span>${l}</span><span>${v}</span></div>`;

  // график прибыли по дням
  const n = daysInMonth(month);
  const byDay = Object.fromEntries(m.days.map(x => [x.d.date, x.r.profitUsdt]));
  const max = Math.max(1, ...Object.values(byDay).map(Math.abs));
  const bars = Array.from({ length: n }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`; const v = byDay[date] || 0;
    return `<button type="button" class="cbar ${v < 0 ? 'neg' : ''}" data-date="${date}" title="${dmy(date)}: ${fmt(v)} ₮"><i style="height:${(Math.abs(v) / max) * 100}%"></i></button>`;
  }).join('');

  $('#monthBody').innerHTML = `
    <div class="card hero">
      <div class="muted small">Чистая прибыль за месяц</div>
      <div class="huge ${m.netUsdt < 0 ? 'bad' : 'good'}">${usd(m.netUsdt)}</div>
      <div class="muted small">после всех расходов Дубая, включая разовые</div>
      ${m.netUsdt < 0 && m.flow > 0 && m.marginUsdt > 0 ? `<div class="hint">До нуля не хватает ещё <b>${fmt(-m.netUsdt / (m.marginUsdt / m.flow) / 1e6, 1)} млн ₽</b> потока при текущей марже</div>` : ''}
      <div class="chart">${bars}</div>
    </div>
    <div class="tiles">
      <div class="tile"><span class="muted small">Поток</span><b>${fmt(m.flow / 1e6, 1)} млн ₽</b></div>
      <div class="tile"><span class="muted small">Дней с потоком</span><b>${m.count}</b></div>
      <div class="tile"><span class="muted small">Ср. себес</span><b class="cost">${m.count ? fmt(m.costRate, 2) : '—'}</b></div>
      <div class="tile"><span class="muted small">Ср. продажа</span><b class="sale">${m.count ? fmt(m.saleRate, 2) : '—'}</b></div>
    </div>
    <div class="card">
      <div class="stitle">USDT</div>
      ${line('Конвертировано по себесу', usd(m.convUsdt))}
      ${line('Выдано клиентам', '− ' + usd(m.clientUsdt))}
      ${line('Маржа', usd(m.marginUsdt), 'tot')}
      ${p.expenses.filter(e => e.level === 'ae' && e.period === 'month' && +e.amount).map(e => line('− ' + esc(e.name), usd(e.amount))).join('')}
      ${m.lumps.filter(e => e.level === 'ae').map(e => line(`− ${esc(e.name)} <span class="tag">${e.period === 'year' ? 'год' : 'разово'}</span>`, usd(+e.amount))).join('')}
      ${line('Чистая прибыль', usd(m.netUsdt), 'tot good')}
    </div>
    <div class="card">
      <div class="stitle">ООО, ₽</div>
      ${line('Агентское вознаграждение', rub(m.agentRub))}
      ${line(`− НДС`, rub(m.vatRub))}
      ${line(`− Банк РФ`, rub(m.bankRub))}
      ${p.expenses.filter(e => e.level === 'ru' && e.period === 'month' && +e.amount).map(e => line('− ' + esc(e.name), rub(e.amount))).join('')}
      ${line(`− Налог на прибыль (база ${rub(m.taxBaseRub)})`, rub(m.profitTaxRub))}
      ${m.lumps.filter(e => e.level === 'ru').map(e => line(`− ${esc(e.name)} <span class="tag">${e.period === 'year' ? 'год' : 'разово'}</span>`, rub(+e.amount))).join('')}
      ${line('Остаток ООО', rub(m.oooResultRub), 'tot ' + (m.oooResultRub < 0 ? 'bad' : ''))}
    </div>
    ${m.count ? '' : '<p class="muted center">В этом месяце ещё нет поступлений</p>'}`;
  document.querySelectorAll('.cbar').forEach(b => b.addEventListener('click', () => { openTab('day'); loadDate(b.dataset.date); }));
}

// ---------------- расходы ----------------
const PERIODS = { month: 'каждый месяц', year: 'раз в год', once: 'разово' };
function renderExpenses() {
  const p = store.getParams();
  const group = (level, title, cur) => {
    const items = p.expenses.filter(e => e.level === level);
    const monthly = items.filter(e => e.period === 'month').reduce((s, e) => s + (+e.amount || 0), 0);
    return `<div class="card"><div class="ghead"><h3>${title}</h3><span class="muted small">в месяц: <b>${fmt(monthly)} ${cur}</b></span></div>
      ${items.map(e => `<div class="exp" data-id="${e.id}">
        <input class="ename" value="${esc(e.name)}" data-f="name" aria-label="Название">
        <div class="erow">
          <div class="eamt"><input value="${fmt(+e.amount || 0)}" inputmode="numeric" data-f="amount" aria-label="Сумма"><span>${cur}</span></div>
          <select data-f="period">${Object.entries(PERIODS).map(([k, v]) => `<option value="${k}" ${e.period === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <button type="button" class="x" data-del="${e.id}" aria-label="Удалить">×</button>
        </div>
        ${e.period !== 'month' ? `<label class="efrom muted small">${e.period === 'year' ? 'месяц оплаты, с' : 'месяц'} <input type="month" value="${e.from || todayMsk().slice(0, 7)}" data-f="from"></label>` : ''}
      </div>`).join('')}
      <button type="button" class="link" data-add="${level}">+ добавить статью</button></div>`;
  };
  $('#expBody').innerHTML = group('ru', '🇷🇺 ООО', '₽') + group('ae', '🇦🇪 Дубай и 🇭🇰 Гонконг', '$');
}
$('#expBody').addEventListener('change', e => {
  const row = e.target.closest('.exp'); if (!row) return;
  const p = store.getParams();
  const item = p.expenses.find(x => x.id === row.dataset.id);
  const f = e.target.dataset.f;
  item[f] = f === 'amount' ? parseNum(e.target.value) : e.target.value;
  if (f === 'period' && item.period !== 'month' && !item.from) item.from = todayMsk().slice(0, 7);
  store.setParams(p);
  renderExpenses();
});
$('#expBody').addEventListener('input', e => {
  if (e.target.dataset.f !== 'amount') return;
  const d = e.target.value.replace(/\D/g, ''); e.target.value = d ? fmt(parseInt(d, 10)) : '';
});
$('#expBody').addEventListener('click', e => {
  const p = store.getParams();
  if (e.target.dataset.add) {
    p.expenses.push({ id: uid(), level: e.target.dataset.add, name: 'Новая статья', amount: 0, period: 'month' });
    store.setParams(p); renderExpenses();
    const rows = document.querySelectorAll('.exp'); const last = [...rows].filter(r => r.dataset.id === p.expenses.at(-1).id)[0];
    last?.querySelector('.ename').select();
  }
  if (e.target.dataset.del) {
    const item = p.expenses.find(x => x.id === e.target.dataset.del);
    if (!confirm(`Удалить статью «${item.name}»?`)) return;
    p.expenses = p.expenses.filter(x => x.id !== item.id);
    store.setParams(p); renderExpenses();
  }
});

// ---------------- ещё: проценты + синхронизация ----------------
const FIELDS = [
  ['🇷🇺 ООО'],
  ['agentPct', 'Агентское вознаграждение', '%'],
  ['vatPct', 'НДС', '%'],
  ['vatOnTop', 'НДС сверху вознаграждения', 'bool'],
  ['bankPct', 'Комиссия банка РФ', '%'],
  ['profitTaxPct', 'Налог на прибыль', '%'],
  ['🇭🇰 Гонконг — себес'],
  ['cost.markupPct', 'Надбавка к курсу ЦБ', '%'],
  ['cost.hkPct', 'Комиссия ГК', '%'],
  ['👤 Гонконг — продажа клиенту'],
  ['sale.markupPct', 'Надбавка к курсу ЦБ', '%'],
  ['sale.hkPct', 'Комиссия ГК', '%'],
];
const getPath = (o, k) => k.split('.').reduce((a, x) => a[x], o);
const setPath = (o, k, v) => { const ks = k.split('.'); const last = ks.pop(); ks.reduce((a, x) => a[x], o)[last] = v; };

function renderSettings() {
  const p = store.getParams();
  let html = '<h3>Проценты</h3>', open = false;
  for (const [k, label, type] of FIELDS) {
    if (!label) { if (open) html += '</fieldset>'; html += `<fieldset><legend>${k}</legend>`; open = true; continue; }
    const v = getPath(p, k);
    if (type === 'bool') html += `<label class="toggle">${label}<input type="checkbox" name="${k}" ${v ? 'checked' : ''}></label>`;
    else html += `<label class="prm"><span>${label}</span><span class="pin"><input name="${k}" inputmode="decimal" value="${fmt(v * 100, 3).replace(/,?0+$/, '')}"><i>%</i></span></label>`;
  }
  html += `</fieldset><p class="muted small">Уже внесённые дни не пересчитываются: у каждого свой курс и проценты на момент ввода.</p>
    <button type="button" id="resetParams" class="link">вернуть всё к значениям из финмодели</button>`;
  $('#paramsForm').innerHTML = html;
  $('#resetParams').addEventListener('click', () => { if (confirm('Вернуть проценты и статьи расходов к значениям из финмодели?')) { store.resetParams(); renderSettings(); } });
  renderSyncBox();
}
$('#paramsForm').addEventListener('change', e => {
  const f = FIELDS.find(x => x[0] === e.target.name); if (!f) return;
  const p = store.getParams();
  setPath(p, f[0], f[2] === 'bool' ? e.target.checked : parseNum(e.target.value) / 100);
  store.setParams(p);
});

function renderSyncBox() {
  const c = store.syncCfg();
  $('#syncLogged').classList.toggle('hidden', !c.refresh);
  $('#loginForm').classList.toggle('hidden', !!c.refresh);
  $('#syncEmail').textContent = c.email || '';
  $('#cfgFields').classList.toggle('hidden', !!(SUPABASE.url && SUPABASE.anonKey));
  if (!c.refresh) { $('#loginForm').url.value = c.url || ''; $('#loginForm').key.value = c.anonKey || ''; }
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target; $('#loginErr').textContent = '';
  const url = SUPABASE.url || f.url.value.trim(), key = SUPABASE.anonKey || f.key.value.trim();
  if (!url || !key) { $('#loginErr').textContent = 'Нет адреса базы — его нужно один раз прописать в config.js'; return; }
  try { await store.login(url, key, f.email.value.trim(), f.password.value); f.password.value = ''; renderSyncBox(); }
  catch (err) { $('#loginErr').textContent = err.message; }
});
$('#logoutBtn').addEventListener('click', () => { store.logout(); renderSyncBox(); });
$('#syncNowBtn').addEventListener('click', () => store.syncNow());
$('#sync').addEventListener('click', () => store.syncCfg().refresh ? store.syncNow() : openTab('set'));

store.onChange(s => {
  const b = $('#sync');
  b.className = 'sync' + ({ ok: ' ok', error: ' err', syncing: ' busy' }[s.state] || '');
  $('#syncText').textContent = { off: 'не подключено', offline: 'офлайн', syncing: 'синхр…', ok: 'общий журнал', error: 'ошибка синхр.' }[s.state];
  b.title = s.message || '';
  if (s.state === 'ok' && !document.activeElement?.matches('input, select')) ({ day: renderDay, month: renderMonth, exp: renderExpenses, set: renderSettings })[currentTab]();
});

// ---------------- старт ----------------
loadDate(st.date);
store.syncNow();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
