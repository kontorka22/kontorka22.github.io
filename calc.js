// Расчёт потока РФ → Гонконг → Дубай по структуре финмодели (лист «Модель Рост»).
//
// Дубай работает всегда. ООО (до трёх) — опционально, каждое включается галочкой.
// Расходы Дубая делятся поровну между включёнными ООО. Если ни одно ООО не включено,
// поток идёт напрямую в Гонконг (без агентского, НДС, банка и налогов РФ).
//
// Статья расходов: { id, name, amount, period: 'month' | 'year' | 'once', from: 'YYYY-MM' }

// У каждого ООО свои проценты и статьи — и для себестоимости, и для продажи.
const OOO_COST = { agentPct: 0.015, vatPct: 0.22, vatOnTop: false, bankPct: 0.005, profitTaxPct: 0.25 };
const OOO_SALE = { agentPct: 0.015, vatPct: 0.22, vatOnTop: false };
const mkOoo = (id, active) => ({ id, name: `ООО ${id}`, active, ...OOO_COST, expenses: [], sale: { ...OOO_SALE } });

export const DEFAULT_PARAMS = {
  ooo: [mkOoo(1, true), mkOoo(2, false), mkOoo(3, false)],
  dubai: [],                                // Дубай (себестоимость): статьи, USD
  cost: { markupRub: 1, hkPct: 0.02 },      // Гонконг (себестоимость): курс ЦБ + 1 ₽, комиссия 2%
  sale: { markupRub: 1, hkPct: 0.025, dubai: [] }, // продажа: Гонконг ЦБ + 1 ₽, 2,5%; свои статьи Дубая
};

export function normalizeParams(p) {
  const out = { ...structuredClone(DEFAULT_PARAMS), ...structuredClone(p || {}) };
  if (!Array.isArray(out.dubai)) out.dubai = [];
  if (!Array.isArray(out.ooo) || out.ooo.length !== 3) out.ooo = structuredClone(DEFAULT_PARAMS.ooo);
  // раньше проценты ООО были общими (p.agentPct, p.sale.agentPct…) — раздаём их каждому ООО
  const oldCost = Object.fromEntries(Object.keys(OOO_COST).filter(k => p?.[k] != null).map(k => [k, p[k]]));
  const oldSale = Object.fromEntries(Object.keys(OOO_SALE).filter(k => p?.sale?.[k] != null).map(k => [k, p.sale[k]]));
  out.ooo = out.ooo.map((o, i) => ({ ...mkOoo(i + 1, !!o.active), ...oldCost, ...o, sale: { ...OOO_SALE, ...oldSale, ...(o.sale || {}) }, expenses: o.expenses || [] }));
  for (const k of Object.keys(OOO_COST)) delete out[k];
  // надбавка к ЦБ раньше была в %, теперь в рублях
  for (const side of ['cost', 'sale']) {
    if (out[side].markupRub == null) out[side] = { ...DEFAULT_PARAMS[side], hkPct: out[side].hkPct ?? DEFAULT_PARAMS[side].hkPct };
    delete out[side].markupPct;
  }
  // продажа раньше была только «Гонконг» (+1,3 ₽) — надбавка по умолчанию теперь +1 ₽
  if (p?.sale && p.sale.agentPct == null && p.sale.dubai == null) out.sale = { ...structuredClone(DEFAULT_PARAMS.sale), hkPct: out.sale.hkPct };
  if (!Array.isArray(out.sale.dubai)) out.sale.dubai = [];
  for (const k of Object.keys(OOO_SALE)) delete out.sale[k];
  for (const k of ['expenses', 'payrollMonthRub', 'dubaiNominalUsdMonth', 'dubaiAccountingUsdMonth']) delete out[k];
  return out;
}

export const daysInMonth = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export const dayShareOfMonth = isoDate => 1 / daysInMonth(isoDate.slice(0, 7));
export const monthlySum = items => items.filter(e => e.period === 'month').reduce((s, e) => s + (+e.amount || 0), 0);

/** Годовые и разовые статьи, которые приходятся на месяц ym. */
export function lumpsIn(items, ym) {
  return items.filter(e => {
    if (!e.from || e.period === 'month') return false;
    if (e.period === 'once') return e.from === ym;
    return e.from <= ym && e.from.slice(5) === ym.slice(5);
  });
}
const lumpSum = (items, ym) => lumpsIn(items, ym).reduce((s, e) => s + (+e.amount || 0), 0);

export const activeOoo = p => p.ooo.filter(o => o.active);

function hk(transitRub, cb, { markupRub, hkPct }) {
  const hkRub = transitRub * hkPct;
  const convRate = cb + markupRub;
  return { hkRub, convRate, usdt: convRate > 0 ? (transitRub - hkRub) / convRate : 0 };
}

/** Сколько удерживает ООО из потока клиента по процентам продажи. */
const saleRetained = (flow, s) => flow * s.agentPct * (s.vatOnTop ? 1 + s.vatPct : 1);

/** ООО: что удерживается из потока и что остаётся у ООО. fixedRub — расходы ООО за период. */
function oooPart(flow, p, fixedRub) { // p — проценты конкретного ООО
  const agentRub = flow * p.agentPct;
  const vatRub = p.vatOnTop ? agentRub * p.vatPct : (agentRub * p.vatPct) / (1 + p.vatPct);
  const retainedRub = agentRub + (p.vatOnTop ? vatRub : 0);
  const revenueRub = p.vatOnTop ? agentRub : agentRub - vatRub;
  const bankRub = flow * p.bankPct;
  const taxBaseRub = Math.max(0, revenueRub - bankRub - fixedRub);
  const taxRub = taxBaseRub * p.profitTaxPct;
  return { agentRub, vatRub, retainedRub, revenueRub, bankRub, fixedRub, taxBaseRub, taxRub,
    resultRub: revenueRub - bankRub - fixedRub - taxRub };
}

/**
 * Один день. ops: [{ amount, ooo }] — ooo: 1..3 или 0 (без ООО).
 * share — доля месяца для ежемесячных расходов (1/дней в месяце; 1 = целый месяц, как в таблице).
 */
export function calcDay(ops, cb, pIn, share) {
  const p = normalizeParams(pIn);
  const act = activeOoo(p);
  const dubaiUsd = monthlySum(p.dubai) * share;
  const dubaiPerUnit = dubaiUsd / Math.max(1, act.length);
  const saleDubaiUsd = monthlySum(p.sale.dubai) * share;
  const saleDubaiPerUnit = saleDubaiUsd / Math.max(1, act.length);

  // группы: каждое ООО (включённое или с поступлениями) + «без ООО»
  const flowBy = {};
  for (const o of ops) { const k = act.length ? (o.ooo || act[0].id) : 0; flowBy[k] = (flowBy[k] || 0) + (+o.amount || 0); }
  const keys = new Set([...act.map(o => o.id), ...Object.keys(flowBy).map(Number)]);

  const units = [...keys].sort().map(id => {
    const o = p.ooo.find(x => x.id === id);
    const flow = flowBy[id] || 0;
    const isOoo = id !== 0;
    const fixed = isOoo && o?.active ? monthlySum(o.expenses) * share : 0;
    const rf = isOoo ? oooPart(flow, o, fixed) : null;
    const transitRub = flow - (rf ? rf.retainedRub : 0);
    const cost = hk(transitRub, cb, p.cost);
    const sale = hk(flow - (isOoo ? saleRetained(flow, o.sale) : 0), cb, p.sale);
    const getsDubai = (isOoo && o?.active) || (!isOoo && !act.length);
    const dubai = getsDubai ? dubaiPerUnit : 0;
    const saleDubai = getsDubai ? saleDubaiPerUnit : 0;
    const costUsdt = cost.usdt - dubai;
    const saleUsdt = sale.usdt - saleDubai;
    return { id, name: isOoo ? o?.name || `ООО ${id}` : 'Без ООО', flow, rf, transitRub, cost, sale, dubaiUsd: dubai, saleDubaiUsd: saleDubai,
      costUsdt, saleUsdt, diffUsdt: costUsdt - saleUsdt,
      costRate: costUsdt > 0 ? flow / costUsdt : 0, saleRate: saleUsdt > 0 ? flow / saleUsdt : 0 };
  });

  const sum = f => units.reduce((s, u) => s + f(u), 0);
  const flow = sum(u => u.flow);
  const costUsdt = sum(u => u.costUsdt), saleUsdt = sum(u => u.saleUsdt);
  return {
    flow, cb, share, units, dubaiUsd, saleDubaiUsd,
    convUsdt: sum(u => u.cost.usdt), saleConvUsdt: sum(u => u.sale.usdt),
    costUsdt, saleUsdt, diffUsdt: costUsdt - saleUsdt,
    costRate: costUsdt > 0 ? flow / costUsdt : 0,
    saleRate: saleUsdt > 0 ? flow / saleUsdt : 0,
    oooResultRub: sum(u => u.rf?.resultRub || 0),
  };
}

/**
 * Сколько USDT получит клиент за рубли по продаже (через ООО или напрямую) и обратно.
 * Без постоянных расходов Дубая продажи — они распределяются на весь поток дня.
 */
export function clientQuote(rub, cb, pIn, oooId = 1) {
  const p = normalizeParams(pIn);
  const o = oooId ? p.ooo.find(x => x.id === +oooId) : null;
  return hk(rub - (o ? saleRetained(rub, o.sale) : 0), cb, p.sale).usdt;
}
export function rubForUsdt(usdt, cb, pIn, oooId = 1) {
  const per = clientQuote(1, cb, pIn, oooId);
  return per > 0 ? usdt / per : 0;
}

// ---------------- отчёты за период ----------------

const pad = n => String(n).padStart(2, '0');
/** Месяцы года, которые уже наступили (для текущего года — по текущий месяц включительно). */
export function monthsOfYear(year, todayYm) {
  const all = Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
  return all.filter(m => m <= todayYm);
}

/**
 * Отчёт за набор месяцев (месяц или год) или за один день.
 * days: [{ date, ops, cb, params }] — у каждого дня свой снимок процентов и курса.
 * p — текущие параметры: статьи расходов и какие ООО включены.
 */
export function periodReport(days, pIn, period) {
  const p = normalizeParams(pIn);
  const act = activeOoo(p);
  const isDay = period.kind === 'day';
  const months = isDay ? [period.date.slice(0, 7)] : period.months;
  const share = isDay ? dayShareOfMonth(period.date) : 1;

  // переменная часть — по дням, без постоянных расходов
  const rows = days.map(d => ({ d, r: calcDay(d.ops, d.cb, d.params, 0) }));
  const flow = rows.reduce((s, x) => s + x.r.flow, 0);
  const convUsdt = rows.reduce((s, x) => s + x.r.convUsdt, 0);
  const saleConvUsdt = rows.reduce((s, x) => s + x.r.saleConvUsdt, 0);

  // Дубай
  const dubaiFixedUsd = months.length * monthlySum(p.dubai) * share;
  const dubaiLumps = isDay ? [] : months.flatMap(m => lumpsIn(p.dubai, m));
  const dubaiLumpUsd = dubaiLumps.reduce((s, e) => s + +e.amount, 0);
  const costUsdt = convUsdt - dubaiFixedUsd - dubaiLumpUsd;
  // Дубай в продаже
  const saleDubaiFixedUsd = months.length * monthlySum(p.sale.dubai) * share;
  const saleDubaiLumps = isDay ? [] : months.flatMap(m => lumpsIn(p.sale.dubai, m));
  const saleDubaiLumpUsd = saleDubaiLumps.reduce((s, e) => s + +e.amount, 0);
  const saleUsdt = saleConvUsdt - saleDubaiFixedUsd - saleDubaiLumpUsd;

  // ООО — налог считается по каждому ООО помесячно
  const ooo = [...new Set([...act.map(o => o.id), ...rows.flatMap(x => x.r.units.filter(u => u.id && u.flow).map(u => u.id))])].sort().map(id => {
    const o = p.ooo.find(x => x.id === id);
    const t = { id, name: o.name, active: o.active, flow: 0, agentRub: 0, vatRub: 0, revenueRub: 0, bankRub: 0, fixedRub: 0, lumpRub: 0, taxRub: 0, resultRub: 0, lumps: [] };
    for (const m of months) {
      const us = rows.filter(x => x.d.date.startsWith(m)).map(x => x.r.units.find(u => u.id === id)).filter(Boolean);
      const s = k => us.reduce((a, u) => a + (u.rf?.[k] || 0), 0);
      const fixed = o.active ? monthlySum(o.expenses) * share : 0;
      const lumps = o.active && !isDay ? lumpsIn(o.expenses, m) : [];
      const lump = lumps.reduce((a, e) => a + +e.amount, 0);
      const rev = s('revenueRub'), bank = s('bankRub');
      const tax = Math.max(0, rev - bank - fixed - lump) * o.profitTaxPct;
      t.flow += us.reduce((a, u) => a + u.flow, 0);
      t.agentRub += s('agentRub'); t.vatRub += s('vatRub'); t.revenueRub += rev; t.bankRub += bank;
      t.fixedRub += fixed; t.lumpRub += lump; t.taxRub += tax; t.lumps.push(...lumps);
      t.resultRub += rev - bank - fixed - lump - tax;
    }
    return t;
  });

  // разбивка для графика: по дням месяца или по месяцам года
  const series = period.kind === 'year'
    ? months.map(m => {
      const rs = rows.filter(x => x.d.date.startsWith(m));
      const v = rs.reduce((s, x) => s + x.r.convUsdt - x.r.saleConvUsdt, 0)
        - monthlySum(p.dubai) - lumpSum(p.dubai, m) + monthlySum(p.sale.dubai) + lumpSum(p.sale.dubai, m);
      return { key: m, value: v };
    })
    : rows.map(x => ({ key: x.d.date, value: x.r.convUsdt - x.r.saleConvUsdt }));

  return {
    flow, count: rows.filter(x => x.r.flow > 0).length,
    convUsdt, saleConvUsdt, saleUsdt, dubaiFixedUsd, dubaiLumpUsd, dubaiLumps, costUsdt,
    saleDubaiFixedUsd, saleDubaiLumpUsd, saleDubaiLumps,
    diffUsdt: costUsdt - saleUsdt,
    costRate: costUsdt > 0 ? flow / costUsdt : 0,
    saleRate: saleUsdt > 0 ? flow / saleUsdt : 0,
    avgCb: flow > 0 ? flow / rows.reduce((s, x) => s + x.r.flow / x.r.cb, 0) : 0,
    ooo, oooResultRub: ooo.reduce((s, o) => s + o.resultRub, 0),
    series,
  };
}
