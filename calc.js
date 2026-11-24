// Расчёт потока РФ → Гонконг → Дубай по структуре финмодели (лист «Модель Рост»).

// Расходы — статьями. level: 'ru' (ООО, ₽) | 'ae' (Дубай + Гонконг, $)
// period: 'month' — каждый месяц; 'year' — раз в год в месяце `from`; 'once' — один раз в месяце `from`.
export const DEFAULT_EXPENSES = [
  // в таблице одной строкой «ФОТ и налоги на ЗП» = 350 000 — взносы заполнить отдельно
  { id: 'ru-payroll', level: 'ru', name: 'ФОТ (зарплаты)', amount: 350000, period: 'month' },
  { id: 'ru-payroll-tax', level: 'ru', name: 'Страховые взносы', amount: 0, period: 'month' },
  { id: 'ru-ndfl', level: 'ru', name: 'НДФЛ', amount: 0, period: 'month' },
  { id: 'ru-capital', level: 'ru', name: 'Уставный капитал', amount: 10000, period: 'once', from: '2026-11' },
  { id: 'ru-kkt', level: 'ru', name: 'Контрольно-кассовая техника', amount: 50000, period: 'year', from: '2026-11' },
  { id: 'ru-1c', level: 'ru', name: 'Программа 1С', amount: 40000, period: 'year', from: '2026-11' },
  { id: 'ru-address', level: 'ru', name: 'Юридический адрес', amount: 15000, period: 'year', from: '2026-11' },
  { id: 'ru-reserve', level: 'ru', name: 'Непредвиденные расходы', amount: 50000, period: 'year', from: '2026-11' },
  { id: 'ae-nominal', level: 'ae', name: 'Номинал', amount: 5000, period: 'month' },
  { id: 'ae-accounting', level: 'ae', name: 'Бух, аудит, резерв на продление лицензии', amount: 5000, period: 'month' },
  { id: 'ae-license', level: 'ae', name: 'Лицензия', amount: 12000, period: 'year', from: '2026-11' },
  { id: 'ae-accounts', level: 'ae', name: 'Счета', amount: 36018, period: 'once', from: '2026-11' },
];

export const DEFAULT_PARAMS = {
  agentPct: 0.015,        // агентское вознаграждение ООО, % от потока
  vatPct: 0.22,           // НДС
  vatOnTop: false,        // false — НДС внутри вознаграждения (22/122)
  bankPct: 0.005,         // комиссия банка РФ, % от потока
  profitTaxPct: 0.25,     // налог на прибыль
  cost: { markupPct: 0.01, hkPct: 0.02 },   // себес: ЦБ +1%, комиссия ГК 2%
  sale: { markupPct: 0.013, hkPct: 0.025 }, // продажа: ЦБ +1,3%, комиссия ГК 2,5%
  expenses: DEFAULT_EXPENSES,
};

/** Параметры старого формата → новый (на случай сохранённых ранее дней). */
export function normalizeParams(p) {
  const out = { ...structuredClone(DEFAULT_PARAMS), ...structuredClone(p || {}) };
  if (!p?.expenses) {
    const ex = structuredClone(DEFAULT_EXPENSES);
    if (p?.payrollMonthRub != null) {
      for (const e of ex) if (e.level === 'ru' && e.period === 'month') e.amount = 0;
      ex.find(e => e.id === 'ru-payroll').amount = p.payrollMonthRub;
    }
    out.expenses = ex;
  }
  delete out.payrollMonthRub; delete out.dubaiNominalUsdMonth; delete out.dubaiAccountingUsdMonth;
  return out;
}

export const daysInMonth = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export const dayShareOfMonth = isoDate => 1 / daysInMonth(isoDate.slice(0, 7));

const monthlySum = (p, level) => p.expenses.filter(e => e.level === level && e.period === 'month').reduce((s, e) => s + (+e.amount || 0), 0);

/** Разовые и годовые статьи, которые приходятся на месяц ym. */
export function lumpExpenses(p, ym) {
  return p.expenses.filter(e => {
    if (!e.from || e.period === 'month') return false;
    if (e.period === 'once') return e.from === ym;
    return e.from <= ym && e.from.slice(5) === ym.slice(5); // год: тот же месяц каждый год
  });
}

function path(transitRub, cb, { markupPct, hkPct }) {
  const hkRub = transitRub * hkPct;
  const beforeConvRub = transitRub - hkRub;
  const convRate = cb * (1 + markupPct);
  return { markupPct, hkPct, hkRub, beforeConvRub, convRate, usdt: convRate > 0 ? beforeConvRub / convRate : 0 };
}

/**
 * Один операционный день. Ежемесячные статьи ложатся на день долей share (1/дней в месяце);
 * share = 1 — расчёт на целый месяц, как в таблице.
 */
export function calcDay(flow, cb, pIn, share) {
  const p = normalizeParams(pIn);
  // РФ — ООО
  const agentRub = flow * p.agentPct;
  const vatRub = p.vatOnTop ? agentRub * p.vatPct : (agentRub * p.vatPct) / (1 + p.vatPct);
  const retainedRub = agentRub + (p.vatOnTop ? vatRub : 0);
  const oooRevenueRub = p.vatOnTop ? agentRub : agentRub - vatRub;
  const bankRub = flow * p.bankPct;
  const ruFixedRub = monthlySum(p, 'ru') * share;
  const taxBaseRub = Math.max(0, oooRevenueRub - bankRub - ruFixedRub);
  const profitTaxRub = taxBaseRub * p.profitTaxPct;
  const oooResultRub = oooRevenueRub - bankRub - ruFixedRub - profitTaxRub; // «Сверка»

  // Гонконг
  const transitRub = flow - retainedRub;
  const cost = path(transitRub, cb, p.cost);
  const sale = path(transitRub, cb, p.sale);

  // Дубай — постоянные расходы только в себесе
  const aeFixedUsd = monthlySum(p, 'ae') * share;
  const distributableUsdt = cost.usdt - aeFixedUsd;
  const clientUsdt = sale.usdt;
  const costRate = distributableUsdt > 0 ? flow / distributableUsdt : 0;
  const saleRate = clientUsdt > 0 ? flow / clientUsdt : 0;
  const profitUsdt = distributableUsdt - clientUsdt;

  return {
    flow, cb, share,
    agentRub, vatRub, retainedRub, oooRevenueRub, bankRub, ruFixedRub, taxBaseRub, profitTaxRub, oooResultRub,
    transitRub, cost, sale, aeFixedUsd, distributableUsdt, clientUsdt, costRate, saleRate, profitUsdt,
    marginUsdt: cost.usdt - clientUsdt,
    profitPct: flow > 0 && cb > 0 ? profitUsdt / (flow / cb) : 0,
  };
}

/** Сколько USDT получит клиент за сумму в рублях (и обратно) — по курсу продажи. */
export function clientQuote(rub, cb, pIn) {
  const p = normalizeParams(pIn);
  const transit = rub * (1 - p.agentPct * (p.vatOnTop ? 1 + p.vatPct : 1));
  return path(transit, cb, p.sale).usdt;
}
export function rubForUsdt(usdt, cb, pIn) {
  const per = clientQuote(1, cb, pIn);
  return per > 0 ? usdt / per : 0;
}

/**
 * Месяц целиком: переменная маржа по дням + постоянные расходы за полный месяц + разовые/годовые статьи.
 * days: [{date, flow, cb, params}], p — текущие параметры (статьи расходов месяца).
 */
export function monthReport(days, pIn, ym) {
  const p = normalizeParams(pIn);
  const rs = days.map(d => ({ d, r: calcDay(d.flow, d.cb, d.params, dayShareOfMonth(d.date)) }));
  const sum = k => rs.reduce((s, x) => s + x.r[k], 0);
  const flow = sum('flow');
  const avgCb = flow > 0 ? flow / rs.reduce((s, x) => s + x.r.flow / x.r.cb, 0) : 0;

  const marginUsdt = sum('marginUsdt');           // себес-конвертация − выдача клиенту (до расходов Дубая)
  const aeFixedUsd = monthlySum(p, 'ae');
  const ruFixedRub = monthlySum(p, 'ru');
  const lumps = lumpExpenses(p, ym);
  const aeLumpUsd = lumps.filter(e => e.level === 'ae').reduce((s, e) => s + +e.amount, 0);
  const ruLumpRub = lumps.filter(e => e.level === 'ru').reduce((s, e) => s + +e.amount, 0);

  const oooRevenueRub = sum('oooRevenueRub'), bankRub = sum('bankRub');
  const taxBaseRub = Math.max(0, oooRevenueRub - bankRub - ruFixedRub);
  const profitTaxRub = taxBaseRub * p.profitTaxPct;
  const oooResultRub = oooRevenueRub - bankRub - ruFixedRub - profitTaxRub - ruLumpRub;

  const netUsdt = marginUsdt - aeFixedUsd - aeLumpUsd;
  return {
    days: rs, count: rs.length, flow, avgCb,
    clientUsdt: sum('clientUsdt'), convUsdt: rs.reduce((s, x) => s + x.r.cost.usdt, 0),
    saleRate: sum('clientUsdt') > 0 ? flow / sum('clientUsdt') : 0,
    costRate: sum('distributableUsdt') > 0 ? flow / sum('distributableUsdt') : 0,
    marginUsdt, aeFixedUsd, aeLumpUsd, netUsdt, lumps,
    agentRub: sum('agentRub'), vatRub: sum('vatRub'), oooRevenueRub, bankRub, ruFixedRub, ruLumpRub,
    taxBaseRub, profitTaxRub, oooResultRub,
  };
}
