// Расчёт потока РФ → Гонконг → Дубай по структуре финмодели (лист «Модель Рост»).
//
// Дубай работает всегда. ООО (до трёх) — опционально, каждое включается галочкой.
// Расходы Дубая делятся поровну между включёнными ООО. Если ни одно ООО не включено,
// поток идёт напрямую в Гонконг (без агентского, НДС, банка и налогов РФ).
//
// Статья расходов: { id, name, amount, period: 'month' | 'year' | 'once', from: 'YYYY-MM' }

export const DEFAULT_PARAMS = {
  // ООО (одинаково для всех ООО)
  agentPct: 0.015,        // агентское вознаграждение, % от потока
  vatPct: 0.22,           // НДС
  vatOnTop: false,        // false — НДС внутри вознаграждения (22/122)
  bankPct: 0.005,         // комиссия банка РФ, % от потока
  profitTaxPct: 0.25,     // налог на прибыль
  // Гонконг
  cost: { markupPct: 0.01, hkPct: 0.02 },   // себестоимость: ЦБ +1%, комиссия ГК 2%
  sale: { markupPct: 0.013, hkPct: 0.025 }, // продажа: ЦБ +1,3%, комиссия ГК 2,5%
  // Расходы
  dubai: [],
  ooo: [
    { id: 1, name: 'ООО 1', active: true, expenses: [] },
    { id: 2, name: 'ООО 2', active: false, expenses: [] },
    { id: 3, name: 'ООО 3', active: false, expenses: [] },
  ],
};

export function normalizeParams(p) {
  const out = { ...structuredClone(DEFAULT_PARAMS), ...structuredClone(p || {}) };
  if (!Array.isArray(out.dubai)) out.dubai = [];
  if (!Array.isArray(out.ooo) || out.ooo.length !== 3) out.ooo = structuredClone(DEFAULT_PARAMS.ooo);
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

function hk(transitRub, cb, { markupPct, hkPct }) {
  const hkRub = transitRub * hkPct;
  const convRate = cb * (1 + markupPct);
  return { hkRub, convRate, usdt: convRate > 0 ? (transitRub - hkRub) / convRate : 0 };
}

/** ООО: что удерживается из потока и что остаётся у ООО. fixedRub — расходы ООО за период. */
function oooPart(flow, p, fixedRub) {
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

  // группы: каждое ООО (включённое или с поступлениями) + «без ООО»
  const flowBy = {};
  for (const o of ops) { const k = act.length ? (o.ooo || act[0].id) : 0; flowBy[k] = (flowBy[k] || 0) + (+o.amount || 0); }
  const keys = new Set([...act.map(o => o.id), ...Object.keys(flowBy).map(Number)]);

  const units = [...keys].sort().map(id => {
    const o = p.ooo.find(x => x.id === id);
    const flow = flowBy[id] || 0;
    const isOoo = id !== 0;
    const fixed = isOoo && o?.active ? monthlySum(o.expenses) * share : 0;
    const rf = isOoo ? oooPart(flow, p, fixed) : null;
    const transitRub = flow - (rf ? rf.retainedRub : 0);
    const cost = hk(transitRub, cb, p.cost);
    const sale = hk(transitRub, cb, p.sale);
    const dubai = (isOoo && o?.active) || (!isOoo && !act.length) ? dubaiPerUnit : 0;
    const costUsdt = cost.usdt - dubai;
    return { id, name: isOoo ? o?.name || `ООО ${id}` : 'Без ООО', flow, rf, transitRub, cost, sale, dubaiUsd: dubai,
      costUsdt, saleUsdt: sale.usdt, diffUsdt: costUsdt - sale.usdt,
      costRate: costUsdt > 0 ? flow / costUsdt : 0, saleRate: sale.usdt > 0 ? flow / sale.usdt : 0 };
  });

  const sum = f => units.reduce((s, u) => s + f(u), 0);
  const flow = sum(u => u.flow);
  const costUsdt = sum(u => u.costUsdt), saleUsdt = sum(u => u.saleUsdt);
  return {
    flow, cb, share, units, dubaiUsd,
    convUsdt: sum(u => u.cost.usdt),
    costUsdt, saleUsdt, diffUsdt: costUsdt - saleUsdt,
    costRate: costUsdt > 0 ? flow / costUsdt : 0,
    saleRate: saleUsdt > 0 ? flow / saleUsdt : 0,
    oooResultRub: sum(u => u.rf?.resultRub || 0),
  };
}

/** Сколько USDT получит клиент за рубли по курсу продажи (через ООО или напрямую) и обратно. */
export function clientQuote(rub, cb, pIn, viaOoo = true) {
  const p = normalizeParams(pIn);
  const transit = viaOoo ? rub * (1 - p.agentPct * (p.vatOnTop ? 1 + p.vatPct : 1)) : rub;
  return hk(transit, cb, p.sale).usdt;
}
export function rubForUsdt(usdt, cb, pIn, viaOoo = true) {
  const per = clientQuote(1, cb, pIn, viaOoo);
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
  const saleUsdt = rows.reduce((s, x) => s + x.r.saleUsdt, 0);

  // Дубай
  const dubaiFixedUsd = months.length * monthlySum(p.dubai) * share;
  const dubaiLumps = isDay ? [] : months.flatMap(m => lumpsIn(p.dubai, m));
  const dubaiLumpUsd = dubaiLumps.reduce((s, e) => s + +e.amount, 0);
  const costUsdt = convUsdt - dubaiFixedUsd - dubaiLumpUsd;

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
      const tax = Math.max(0, rev - bank - fixed - lump) * p.profitTaxPct;
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
      const v = rs.reduce((s, x) => s + x.r.convUsdt - x.r.saleUsdt, 0) - monthlySum(p.dubai) - lumpSum(p.dubai, m);
      return { key: m, value: v };
    })
    : rows.map(x => ({ key: x.d.date, value: x.r.convUsdt - x.r.saleUsdt }));

  return {
    flow, count: rows.filter(x => x.r.flow > 0).length,
    convUsdt, saleUsdt, dubaiFixedUsd, dubaiLumpUsd, dubaiLumps, costUsdt,
    diffUsdt: costUsdt - saleUsdt,
    costRate: costUsdt > 0 ? flow / costUsdt : 0,
    saleRate: saleUsdt > 0 ? flow / saleUsdt : 0,
    avgCb: flow > 0 ? flow / rows.reduce((s, x) => s + x.r.flow / x.r.cb, 0) : 0,
    ooo, oooResultRub: ooo.reduce((s, o) => s + o.resultRub, 0),
    series,
  };
}
