import { calcDay, periodReport, dayShareOfMonth, clientQuote, rubForUsdt, daysInMonth, monthlySum, monthsOfYear, activeOoo, channel } from './calc.js?v=13';
import { getUsdRate, todayMsk, addDays } from './cbr.js?v=13';
import { SUPABASE } from './config.js?v=13';
import * as store from './store.js?v=13';

const $ = s => document.querySelector(s);
const nf = d => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (v, d = 0) => (Number.isFinite(v) ? nf(d).format(v) : '—');
const parseNum = s => { const v = parseFloat(String(s).replace(/[\s ]/g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };
const dmy = iso => iso.split('-').reverse().join('.');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const usdt = (v, d = 0) => `${fmt(v, d)} USDT`;
const rub = v => `${fmt(v)} ₽`;
const sign = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d);

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
const TITLES = { day: 'День', rep: 'Отчёт', cost: 'Себестоимость', sale: 'Продажа' };
const RENDER = { day: () => renderDay(), rep: () => renderReport(), cost: () => renderCost(), sale: () => renderSale() };
let currentTab = 'day';
function openTab(name) {
  currentTab = name;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  $('#title').textContent = TITLES[name];
  RENDER[name]();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => openTab(b.dataset.tab)));

// курс ЦБ на сегодня — для вкладок «Себестоимость» и «Продажа»
let todayCb = null;
getUsdRate(todayMsk()).then(r => { if (!r.notPublished) { todayCb = r.value; if (currentTab === 'cost' || currentTab === 'sale') RENDER[currentTab](); } }).catch(() => {});

// ---------------- день ----------------
const st = { date: todayMsk(), cb: null, cbDate: null, cbManual: null, cbErr: '', reqId: 0, qMode: 'rub', qVal: 0, ooo: null };
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
    if (r.notPublished) st.cbErr = `на ${dmy(date)} ЦБ ещё не опубликовал курс (обычно ~15:30 МСК)`;
    else {
      st.cb = r.value; st.cbDate = r.date; st.cbErr = '';
      const sv = store.getDay(date);
      if (refetch && sv) store.saveDay({ ...sv, cb: r.value, cbDate: r.date, cbManual: false });
    }
  } catch { if (id === st.reqId) st.cbErr = 'нет связи с ЦБ — нажмите, чтобы ввести вручную'; }
  if (id === st.reqId) renderDay();
}

function renderCb() {
  const v = effectiveCb();
  $('#cbValue').textContent = v ? fmt(v, 4) : '—';
  $('#cbNote').textContent = st.cbErr
    || (st.cbManual != null ? 'введён вручную · нажмите, чтобы изменить'
      : st.cbDate ? `официальный курс на ${dmy(st.cbDate)}${st.cbDate !== st.date ? ` (действует на ${dmy(st.date)})` : ''}` : '');
  $('#cbCard').classList.toggle('warn', !v);
}

function renderOooPick() {
  const act = activeOoo(store.getParams());
  if (!act.find(o => o.id === st.ooo)) st.ooo = act[0]?.id ?? 0;
  $('#oooPick').innerHTML = act.length > 1
    ? `<span class="muted small">Поступает на</span>${act.map(o => `<button type="button" data-ooo="${o.id}" class="${o.id === st.ooo ? 'on' : ''}">${esc(o.name)}</button>`).join('')}`
    : act.length === 0 ? '<span class="muted small">Все ООО и счёт выключены — поток идёт напрямую в Гонконг</span>' : '';
  document.querySelectorAll('[data-ooo]').forEach(b => b.addEventListener('click', () => { st.ooo = +b.dataset.ooo; renderOooPick(); renderQuote(); }));
}

function renderQuote() {
  const cb = effectiveCb(), p = store.getParams(), via = st.ooo;
  const isRub = st.qMode === 'rub';
  $('#qLabel').textContent = isRub ? 'Клиент платит, ₽' : 'Клиент хочет получить, USDT';
  $('#qCur').textContent = isRub ? '₽' : 'USDT';
  if (!cb || !st.qVal) { $('#qOut').textContent = ''; $('#qRate').textContent = ''; $('#qAdd').disabled = true; return; }
  const u = isRub ? clientQuote(st.qVal, cb, p, via) : st.qVal;
  const r = isRub ? st.qVal : rubForUsdt(st.qVal, cb, p, via);
  $('#qOut').innerHTML = isRub ? `получит <b>${usdt(u, 2)}</b>` : `заплатит <b>${rub(Math.ceil(r))}</b>`;
  $('#qRate').textContent = `по курсу продажи ${fmt(r / u, 2)} ₽ за 1 USDT`;
  $('#qAdd').disabled = false;
}

function renderDay() {
  const d = new Date(st.date + 'T00:00:00'), today = todayMsk();
  const rel = st.date === today ? 'Сегодня' : st.date === addDays(today, 1) ? 'Завтра' : st.date === addDays(today, -1) ? 'Вчера' : '';
  $('#dLabel').innerHTML = `${rel ? `<b>${rel}</b> · ` : ''}${d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })}`;
  $('#date').value = st.date;
  renderCb(); renderOooPick(); renderQuote();

  const saved = store.getDay(st.date);
  const cb = saved?.cb || effectiveCb();
  const p = store.getParams();
  const ops = saved?.ops || [];
  const r = cb && ops.length ? calcDay(ops, cb, p, dayShareOfMonth(st.date)) : null;

  $('#sFlow').textContent = rub(r?.flow || 0);
  $('#sOps').textContent = ops.length ? `${ops.length} поступл.` : 'поступлений пока нет';
  $('#sCostSum').textContent = r ? usdt(r.costUsdt) : '—';
  $('#sCostRate').textContent = r ? `курс ${fmt(r.costRate, 2)}` : '';
  $('#sSaleSum').textContent = r ? usdt(r.saleUsdt) : '—';
  $('#sSaleRate').textContent = r ? `курс ${fmt(r.saleRate, 2)}` : '';
  $('#sDiffSum').textContent = r ? `${sign(r.diffUsdt)} USDT` : '—';
  $('#sDiffSum').className = r && r.diffUsdt < 0 ? 'bad' : 'good';
  $('#sDiffRate').textContent = r ? `курс ${sign(r.saleRate - r.costRate, 2)} · ≈ ${rub(r.diffUsdt * cb)}` : '';

  const many = activeOoo(p).length > 1;
  $('#ops').innerHTML = ops.length ? `<div class="card ops"><div class="muted small">Поступления</div>${[...ops].reverse().map(o => `
    <div class="op"><div><b>${rub(o.amount)}</b> <span class="muted small">→ ${usdt(clientQuote(o.amount, cb, p, o.ooo ?? (activeOoo(p)[0]?.id || 1)), 2)}</span>
      <div class="muted small">${o.at ? new Date(o.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}${many && o.ooo ? ' · ' + esc(channel(p, o.ooo)?.name || '') : ''}${o.by ? ' · ' + esc(o.by) : ''}</div></div>
      <button type="button" class="x" data-op="${o.id}" aria-label="Удалить">×</button></div>`).join('')}</div>` : '';
  document.querySelectorAll('[data-op]').forEach(b => b.addEventListener('click', () => removeOp(b.dataset.op)));
}

function addOp(amount) {
  const cb = effectiveCb();
  if (!cb || !amount) return;
  const saved = store.getDay(st.date);
  const ops = [...(saved?.ops || []), { id: uid(), amount: Math.round(amount), ooo: st.ooo, at: new Date().toISOString(), by: store.syncCfg().email || '' }];
  store.saveDay({ date: st.date, ops, flow: ops.reduce((s, o) => s + o.amount, 0), cb, cbDate: st.cbManual != null ? null : st.cbDate, cbManual: st.cbManual != null });
  st.qVal = 0; $('#qIn').value = '';
  renderDay();
}
function removeOp(id) {
  const saved = store.getDay(st.date);
  const op = saved.ops.find(o => o.id === id);
  if (!confirm(`Удалить поступление ${rub(op.amount)}?`)) return;
  const ops = saved.ops.filter(o => o.id !== id);
  if (!ops.length) store.deleteDay(st.date);
  else store.saveDay({ ...saved, ops, flow: ops.reduce((s, o) => s + o.amount, 0) });
  renderDay();
}

moneyInput($('#qIn'), v => { st.qVal = v; renderQuote(); }, true);
$('#qSwap').addEventListener('click', () => { st.qMode = st.qMode === 'rub' ? 'usdt' : 'rub'; st.qVal = 0; $('#qIn').value = ''; renderQuote(); $('#qIn').focus(); });
$('#qAdd').addEventListener('click', () => {
  const p = store.getParams();
  addOp(st.qMode === 'rub' ? st.qVal : Math.ceil(rubForUsdt(st.qVal, effectiveCb(), p, st.ooo)));
});
$('#qIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('#qAdd').click(); });
$('#dPrev').addEventListener('click', () => loadDate(addDays(st.date, -1)));
$('#dNext').addEventListener('click', () => loadDate(addDays(st.date, 1)));
$('#date').addEventListener('change', e => e.target.value && loadDate(e.target.value));
$('#cbCard').addEventListener('click', () => {
  const v = prompt('Курс ЦБ вручную, ₽ за 1 USD\n(оставьте пустым — вернуть официальный курс)', effectiveCb() ? String(effectiveCb()).replace('.', ',') : '');
  if (v === null) return;
  const n = parseNum(v);
  if (n > 0) {
    st.cbManual = n;
    const saved = store.getDay(st.date);
    if (saved) store.saveDay({ ...saved, cb: n, cbManual: true, cbDate: null });
    renderDay();
  } else loadDate(st.date, true);
});

// ---------------- отчёт ----------------
const rep = { kind: 'month', date: todayMsk(), month: todayMsk().slice(0, 7), year: +todayMsk().slice(0, 4) };
const monthName = m => new Date(m + '-01T00:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
const shiftMonth = (m, n) => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
document.querySelectorAll('#repKind button').forEach(b => b.addEventListener('click', () => { rep.kind = b.dataset.k; renderReport(); }));
function shiftRep(n) {
  if (rep.kind === 'day') rep.date = addDays(rep.date, n);
  else if (rep.kind === 'month') rep.month = shiftMonth(rep.month, n);
  else rep.year += n;
  renderReport();
}
$('#rPrev').addEventListener('click', () => shiftRep(-1));
$('#rNext').addEventListener('click', () => shiftRep(1));

function renderReport() {
  document.querySelectorAll('#repKind button').forEach(b => b.classList.toggle('on', b.dataset.k === rep.kind));
  const p = store.getParams();
  const all = store.listDays();
  let days, period, label;
  if (rep.kind === 'day') {
    days = all.filter(d => d.date === rep.date); period = { kind: 'day', date: rep.date };
    label = new Date(rep.date + 'T00:00:00').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
  } else if (rep.kind === 'month') {
    days = all.filter(d => d.date.startsWith(rep.month)); period = { kind: 'month', months: [rep.month] }; label = monthName(rep.month);
  } else {
    days = all.filter(d => d.date.startsWith(rep.year + '-'));
    period = { kind: 'year', months: monthsOfYear(rep.year, todayMsk().slice(0, 7)) }; label = `${rep.year} год`;
  }
  days = days.filter(d => d.ops.length && d.cb);
  // постоянные расходы считаем с первого месяца, в котором были поступления
  const firstMonth = all.filter(d => d.ops.length).map(d => d.date.slice(0, 7)).sort()[0] || todayMsk().slice(0, 7);
  if (period.months) period.months = period.months.filter(m => m >= firstMonth);
  $('#rLabel').innerHTML = `<b>${label}</b>`;
  const r = periodReport(days, p, period);
  const line = (l, v, cls = '') => `<div class="srow ${cls}"><span>${l}</span><span>${v}</span></div>`;
  const usd = v => `${fmt(v)} USD`;
  const tag = e => `<span class="tag">${e.period === 'year' ? 'раз в год' : 'разово'}</span>`;
  const word = { day: 'за день', month: 'за месяц', year: 'за год' }[rep.kind];

  let chart = '';
  if (rep.kind !== 'day') {
    const keys = rep.kind === 'month'
      ? Array.from({ length: daysInMonth(rep.month) }, (_, i) => `${rep.month}-${String(i + 1).padStart(2, '0')}`)
      : Array.from({ length: 12 }, (_, i) => `${rep.year}-${String(i + 1).padStart(2, '0')}`);
    const val = Object.fromEntries(r.series.map(s => [s.key, s.value]));
    const max = Math.max(1, ...Object.values(val).map(Math.abs));
    chart = `<div class="chart ${rep.kind}">${keys.map(k => `<button type="button" class="cbar ${val[k] < 0 ? 'neg' : ''}" data-key="${k}"><i style="height:${(Math.abs(val[k] || 0) / max) * 100}%"></i>${rep.kind === 'year' ? `<em>${new Date(k + '-01T00:00:00').toLocaleDateString('ru-RU', { month: 'narrow' })}</em>` : ''}</button>`).join('')}</div>
      <div class="muted small center">${rep.kind === 'month' ? 'разница по дням, до постоянных расходов · нажмите на день' : 'разница по месяцам · нажмите на месяц'}</div>`;
  }

  const n = activeOoo(p).length;
  const dubaiMonthly = p.dubai.filter(e => e.period === 'month' && +e.amount);
  const mult = rep.kind === 'day' ? dayShareOfMonth(rep.date) : period.months.length;
  $('#repBody').innerHTML = `
    <div class="card hero">
      <div class="muted small">Разница ${word} — после всех расходов Дубая</div>
      <div class="huge ${r.diffUsdt < 0 ? 'bad' : 'good'}">${sign(r.diffUsdt)} USDT</div>
      <div class="muted small">${r.avgCb ? `≈ ${rub(r.diffUsdt * r.avgCb)} по среднему курсу ЦБ ${fmt(r.avgCb, 2)}` : ''}</div>
      ${r.diffUsdt < 0 && r.flow > 0 && r.convUsdt > r.saleUsdt ? `<div class="hint">Чтобы выйти в ноль, нужно ещё <b>${fmt(-r.diffUsdt / ((r.convUsdt - r.saleUsdt) / r.flow) / 1e6, 1)} млн ₽</b> потока</div>` : ''}
      ${chart}
    </div>
    <div class="three">
      <div class="cell"><span class="lab">Поток</span><b>${fmt(r.flow / 1e6, 2)} млн ₽</b><span class="rate">${rep.kind === 'day' ? '' : `${r.count} дн. с потоком`}</span></div>
      <div class="cell"><span class="lab">Себес</span><b class="cost">${usdt(r.costUsdt)}</b><span class="rate">${r.flow ? `курс ${fmt(r.costRate, 2)}` : ''}</span></div>
      <div class="cell"><span class="lab">Продажа клиентам</span><b class="sale">${usdt(r.saleUsdt)}</b><span class="rate">${r.flow ? `курс ${fmt(r.saleRate, 2)}` : ''}</span></div>
    </div>
    <div class="card">
      <div class="stitle">🇦🇪 Дубай</div>
      ${line('Сконвертировано в Гонконге', usdt(r.convUsdt))}
      ${line('Выдано клиентам', '− ' + usdt(r.saleUsdt))}
      ${r.saleDubaiFixedUsd + r.saleDubaiLumpUsd ? `<div class="muted small">в т.ч. удержано Дубаем с клиентов: ${fmt(r.saleDubaiFixedUsd + r.saleDubaiLumpUsd)} USD</div>` : ''}
      ${dubaiMonthly.map(e => line(`− ${esc(e.name)}${rep.kind === 'day' ? ' (доля за день)' : ''}`, usd(e.amount * mult))).join('')}
      ${r.dubaiLumps.map(e => line(`− ${esc(e.name)} ${tag(e)}`, usd(+e.amount))).join('')}
      ${line('Разница', `${sign(r.diffUsdt)} USDT`, 'tot ' + (r.diffUsdt < 0 ? 'bad' : 'good'))}
      ${n > 1 ? `<div class="muted small">Расходы Дубая делятся на ${n} канала (ООО и счёт)</div>` : ''}
    </div>
    ${r.ooo.map(o => o.kind === 'nr' ? `<div class="card">
      <div class="stitle">🏦 ${esc(o.name)}${o.active ? '' : ' <span class="tag">выключен</span>'}</div>
      ${line('Поток через счёт', rub(o.flow))}
      ${line('− Комиссия банка', rub(o.bankRub))}
    </div>` : `<div class="card">
      <div class="stitle">🇷🇺 ${esc(o.name)}${o.active ? '' : ' <span class="tag">выключено</span>'}</div>
      ${line('Поток через ООО', rub(o.flow))}
      ${line('Агентское вознаграждение', rub(o.agentRub))}
      ${line('− НДС', rub(o.vatRub))}
      ${line('− Банк РФ', rub(o.bankRub))}
      ${line(`− Расходы ООО${rep.kind === 'day' ? ' (доля за день)' : ''}`, rub(o.fixedRub))}
      ${o.lumps.map(e => line(`− ${esc(e.name)} ${tag(e)}`, rub(+e.amount))).join('')}
      ${line('− Налог на прибыль', rub(o.taxRub))}
      ${line('Остаток ООО', rub(o.resultRub), 'tot ' + (o.resultRub < 0 ? 'bad' : ''))}
    </div>`).join('')}
    ${r.flow ? '' : '<p class="muted center">За этот период поступлений нет</p>'}`;

  document.querySelectorAll('.cbar').forEach(b => b.addEventListener('click', () => {
    if (rep.kind === 'month') { rep.kind = 'day'; rep.date = b.dataset.key; } else { rep.kind = 'month'; rep.month = b.dataset.key; }
    renderReport();
  }));
}

// ---------------- себестоимость и продажа ----------------
// Обе вкладки устроены одинаково: ООО → Дубай → Гонконг, у каждой свои значения.
// Ввод сохраняется сразу на каждое нажатие, вкладка при этом не перерисовывается —
// иначе поле, в которое только что нажали, пересоздаётся и набранное теряется.

const PERIODS = { month: 'каждый месяц', year: 'раз в год', once: 'разово' };
const getPath = (o, k) => k.split('.').reduce((a, x) => a[x], o);
const setPath = (o, k, v) => { const ks = k.split('.'); const last = ks.pop(); ks.reduce((a, x) => a[x], o)[last] = v; };

function itemsHtml(items, cur, owner) {
  return items.map(e => `<div class="exp" data-owner="${owner}" data-id="${e.id}">
      <input class="ename" value="${esc(e.name)}" data-f="name" placeholder="Название статьи">
      <div class="erow">
        <div class="eamt"><input value="${+e.amount ? fmt(+e.amount) : ''}" placeholder="0" inputmode="numeric" data-f="amount"><span>${cur}</span></div>
        <select data-f="period">${Object.entries(PERIODS).map(([k, v]) => `<option value="${k}" ${e.period === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button type="button" class="x" data-del aria-label="Удалить">×</button>
      </div>
      ${e.period !== 'month' ? `<label class="efrom muted small">${e.period === 'year' ? 'месяц оплаты' : 'месяц'} <input type="month" value="${e.from || todayMsk().slice(0, 7)}" data-f="from"></label>` : ''}
    </div>`).join('') + `<button type="button" class="addbtn" data-add="${owner}">+ Добавить статью</button>`;
}
function fieldHtml(path, label, type, p) {
  const v = getPath(p, path);
  if (type === 'bool') return `<label class="toggle">${label}<input type="checkbox" data-p="${path}" data-t="bool" ${v ? 'checked' : ''}></label>`;
  const shown = fmt(type === 'rub' ? v : v * 100, 3).replace(/,?0+$/, '');
  return `<label class="prm"><span>${label}</span><span class="pin"><input data-p="${path}" data-t="${type}" inputmode="decimal" value="${shown}"><i>${type === 'rub' ? '₽' : '%'}</i></span></label>`;
}
const ownerList = (p, owner) => owner === 'dubai' ? p.dubai : owner === 'saleDubai' ? p.sale.dubai : p.ooo.find(o => 'ooo' + o.id === owner).expenses;
const total = items => `${fmt(monthlySum(items))}`;
const oooHead = o => `<div class="ohead">
    <input class="oname" value="${esc(o.name)}" data-oname="${o.id}" aria-label="Название ООО">
    <label class="switch" title="Учитывать в расчётах"><input type="checkbox" data-oon="${o.id}" ${o.active ? 'checked' : ''}><span></span></label>
  </div>`;

function renderCost() {
  const p = store.getParams(), act = activeOoo(p);
  $('#costBody').innerHTML = `
    <div class="card">
      <div class="ghead"><h3>🇷🇺 ООО</h3><span class="muted small">в расчётах: <b>${act.length} из 4</b></span></div>
      ${p.ooo.map((o, i) => `<div class="ooo ${o.active ? '' : 'off'}">
        ${oooHead(o)}
        ${o.active ? `
          ${fieldHtml(`ooo.${i}.agentPct`, 'Агентское вознаграждение', '%', p)}
          ${fieldHtml(`ooo.${i}.vatPct`, 'НДС', '%', p)}
          ${fieldHtml(`ooo.${i}.vatOnTop`, 'НДС сверху вознаграждения', 'bool', p)}
          ${fieldHtml(`ooo.${i}.bankPct`, 'Комиссия банка РФ', '%', p)}
          ${fieldHtml(`ooo.${i}.profitTaxPct`, 'Налог на прибыль', '%', p)}
          <div class="subhead">Статьи расходов · в месяц <b data-total="ooo${o.id}">${total(o.expenses)}</b> ₽</div>
          ${itemsHtml(o.expenses, '₽', 'ooo' + o.id)}` : '<div class="muted small">не учитывается в расчётах</div>'}
      </div>`).join('')}
      <div class="ooo nr ${p.nr.active ? '' : 'off'}">
        ${oooHead(p.nr)}
        ${p.nr.active ? fieldHtml('nr.bankPct', 'Комиссия банка', '%', p) : '<div class="muted small">не учитывается в расчётах</div>'}
      </div>
    </div>
    <div class="card">
      <div class="ghead"><h3>🇦🇪 Дубай</h3><span class="muted small">в месяц <b data-total="dubai">${total(p.dubai)}</b> USD</span></div>
      <div class="muted small">Работает всегда.${act.length > 1 ? ` Делится на ${act.length} ООО.` : ''}</div>
      ${itemsHtml(p.dubai, 'USD', 'dubai')}
    </div>
    <div class="card">
      <h3>🇭🇰 Гонконг</h3>
      ${fieldHtml('cost.markupRub', 'Надбавка к курсу ЦБ', 'rub', p)}
      ${fieldHtml('cost.hkPct', 'Комиссия банка ГК', '%', p)}
    </div>
    <p class="muted small pad">Любое изменение сразу пересчитывает все дни и отчёты. Курс ЦБ у каждого дня свой — на его дату.</p>`;
  updatePreviews();
}

function renderSale() {
  const p = store.getParams(), act = activeOoo(p);
  $('#saleBody').innerHTML = `
    <div class="card">
      <div class="ghead"><h3>🇷🇺 ООО</h3><span class="muted small">в расчётах: <b>${act.length} из 4</b></span></div>
      ${p.ooo.map((o, i) => `<div class="ooo ${o.active ? '' : 'off'}">
        ${oooHead(o)}
        ${o.active ? `
          ${fieldHtml(`ooo.${i}.sale.agentPct`, 'Агентское вознаграждение', '%', p)}
          ${fieldHtml(`ooo.${i}.sale.vatPct`, 'НДС', '%', p)}
          ${fieldHtml(`ooo.${i}.sale.vatOnTop`, 'НДС сверху вознаграждения', 'bool', p)}` : '<div class="muted small">не учитывается в расчётах</div>'}
      </div>`).join('')}
      <div class="ooo nr ${p.nr.active ? '' : 'off'}">
        ${oooHead(p.nr)}
        ${p.nr.active ? fieldHtml('nr.sale.bankPct', 'Комиссия банка', '%', p) : '<div class="muted small">не учитывается в расчётах</div>'}
      </div>
    </div>
    <div class="card">
      <div class="ghead"><h3>🇦🇪 Дубай</h3><span class="muted small">в месяц <b data-total="saleDubai">${total(p.sale.dubai)}</b> USD</span></div>
      <div class="muted small">Удерживается из выдачи клиентам за день.${act.length > 1 ? ` Делится на ${act.length} ООО.` : ''}</div>
      ${itemsHtml(p.sale.dubai, 'USD', 'saleDubai')}
    </div>
    <div class="card">
      <h3>🇭🇰 Гонконг</h3>
      ${fieldHtml('sale.markupRub', 'Надбавка к курсу ЦБ', 'rub', p)}
      ${fieldHtml('sale.hkPct', 'Комиссия ГК', '%', p)}
    </div>
    <div class="card">
      <h3>➕ Наценка</h3>
      ${fieldHtml('sale.extraRub', 'К итоговому курсу продажи', 'rub', p)}
      <div class="muted small">Прибавляется к курсу клиента после ООО, Дубая и Гонконга.</div>
    </div>
    <p class="muted small pad">Любое изменение сразу пересчитывает все дни и отчёты. Курс ЦБ у каждого дня свой — на его дату.</p>`;
  updatePreviews();
}

function updatePreviews() {
  const p = store.getParams(), act = activeOoo(p);
  if (!todayCb) return;
  const ids = act.length ? act.map(o => o.id) : [0];
  const costR = id => calcDay([{ amount: 1e7, ooo: id }], todayCb, p, 0).costRate;
  const saleR = id => 1 / clientQuote(1, todayCb, p, id);
  const others = f => ids.slice(1).map(id => ` · ${esc(channel(p, id).name)}: ${fmt(f(id), 2)}`).join('');
  const who = ids[0] ? (act.length > 1 ? ` · ${channel(p, ids[0]).name}` : '') : ' · ООО и счёт выключены';
  $('#costPreview').textContent = `${fmt(costR(ids[0]), 2)} ₽ за 1 USDT`;
  $('#costPreviewNote').textContent = `ЦБ ${fmt(todayCb, 4)}${who}${others(costR)} · без постоянных расходов — они зависят от потока за день`;
  $('#salePreview').textContent = `${fmt(saleR(ids[0]), 2)} ₽ за 1 USDT`;
  $('#salePreviewNote').textContent = `ЦБ ${fmt(todayCb, 4)}${who}${others(saleR)} · без постоянных расходов Дубая`;
}

function saveField(el) {
  const p = store.getParams();
  if (el.dataset.p) {
    const t = el.dataset.t;
    setPath(p, el.dataset.p, t === 'bool' ? el.checked : t === 'rub' ? parseNum(el.value) : parseNum(el.value) / 100);
  } else if (el.dataset.oname) {
    channel(p, el.dataset.oname).name = el.value.trim() || (+el.dataset.oname === 4 ? 'Нерезидентский счёт (Дубай)' : `ООО ${el.dataset.oname}`);
  } else {
    const row = el.closest('.exp'); if (!row) return;
    const item = ownerList(p, row.dataset.owner).find(x => x.id === row.dataset.id);
    const f = el.dataset.f;
    item[f] = f === 'amount' ? parseNum(el.value) : el.value;
    if (f === 'period' && item.period !== 'month' && !item.from) item.from = todayMsk().slice(0, 7);
    const tot = document.querySelector(`[data-total="${row.dataset.owner}"]`);
    if (tot) tot.textContent = total(ownerList(p, row.dataset.owner));
  }
  store.setParams(p);
  updatePreviews();
}

for (const body of [$('#costBody'), $('#saleBody')]) {
  const rerender = () => (body.id === 'costBody' ? renderCost() : renderSale());
  body.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.f === 'amount') { const d = el.value.replace(/\D/g, ''); el.value = d ? fmt(parseInt(d, 10)) : ''; }
    if (el.dataset.f === 'amount' || el.dataset.f === 'name' || el.dataset.oname || (el.dataset.p && el.dataset.t !== 'bool')) saveField(el);
  });
  body.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.oon) {
      const p = store.getParams(); channel(p, el.dataset.oon).active = el.checked; store.setParams(p); rerender(); return;
    }
    if (el.dataset.t === 'bool' || el.dataset.f === 'from') saveField(el);
    if (el.dataset.f === 'period') { saveField(el); rerender(); }
  });
  body.addEventListener('click', e => {
    const p = store.getParams();
    if (e.target.dataset.add) {
      const id = uid();
      ownerList(p, e.target.dataset.add).push({ id, name: '', amount: 0, period: 'month' });
      store.setParams(p); rerender();
      document.querySelector(`.exp[data-id="${id}"] .ename`)?.focus();
    }
    if (e.target.hasAttribute('data-del')) {
      const row = e.target.closest('.exp');
      const list = ownerList(p, row.dataset.owner);
      const item = list.find(x => x.id === row.dataset.id);
      if (!confirm(`Удалить статью «${item.name || 'без названия'}»?`)) return;
      list.splice(list.indexOf(item), 1);
      store.setParams(p); rerender();
    }
  });
}

// ---------------- общий журнал (вход) ----------------
const dlg = $('#syncDlg');
function renderSyncBox() {
  const c = store.syncCfg();
  $('#syncLogged').classList.toggle('hidden', !c.refresh);
  $('#loginForm').classList.toggle('hidden', !!c.refresh);
  $('#syncEmail').textContent = c.email || '';
  $('#cfgFields').classList.toggle('hidden', !!(SUPABASE.url && SUPABASE.anonKey));
  if (!c.refresh) { $('#loginForm').url.value = c.url || ''; $('#loginForm').key.value = c.anonKey || ''; }
}
$('#sync').addEventListener('click', () => { renderSyncBox(); dlg.showModal(); });
$('#syncClose').addEventListener('click', () => dlg.close());
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target; $('#loginErr').textContent = '';
  const url = SUPABASE.url || f.url.value.trim(), key = SUPABASE.anonKey || f.key.value.trim();
  if (!url || !key) { $('#loginErr').textContent = 'Общая база ещё не подключена'; return; }
  try { await store.login(url, key, f.email.value.trim(), f.password.value); f.password.value = ''; renderSyncBox(); }
  catch (err) { $('#loginErr').textContent = err.message; }
});
$('#logoutBtn').addEventListener('click', () => { store.logout(); renderSyncBox(); });
$('#syncNowBtn').addEventListener('click', () => store.syncNow());

store.onChange(s => {
  const b = $('#sync');
  b.className = 'sync' + ({ ok: ' ok', error: ' err', syncing: ' busy' }[s.state] || '');
  $('#syncText').textContent = { off: 'не подключено', offline: 'офлайн', syncing: 'синхр…', ok: 'общий журнал', error: 'ошибка синхр.' }[s.state];
  b.title = s.message || '';
  if (s.state === 'ok' && !document.activeElement?.matches('input, select')) RENDER[currentTab]();
});

// ---------------- старт ----------------
loadDate(st.date);
store.syncNow();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
