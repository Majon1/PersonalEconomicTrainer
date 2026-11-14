import { SHOP_CATALOG } from './data';
import { SEASONALITY, type SeasonSeries } from './seasonality';
import type {
  BasketKey,
  BasketSummary,
  Budget,
  BudgetLine,
  BudgetStatus,
  ChartPayload,
  EmergencyFund,
  PurchaseVerdict,
  LabelOverride,
  MentorMood,
  MoneyMood,
  MoneyMoodLevel,
  RiskyPurchase,
  SeasonHeadsUp,
  PersonaConfig,
  PlayerProgress,
  ShopItem,
  SuspicionQuest,
  Transaction,
  WhatIfAsset,
  WhatIfPoint,
  WhatIfResult,
} from './types';

export const XP_PER_LEVEL = 150;

export function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1);
}

export function xpProgressInLevel(xp: number): {
  level: number;
  currentInLevel: number;
  neededForNext: number;
  pct: number;
} {
  const level = levelFromXp(xp);
  const floor = (level - 1) * XP_PER_LEVEL;
  const currentInLevel = Math.max(0, xp - floor);
  return {
    level,
    currentInLevel,
    neededForNext: XP_PER_LEVEL,
    pct: Math.min(100, Math.round((currentInLevel / XP_PER_LEVEL) * 100)),
  };
}

/** Purchases up to this size count as "slips"; bigger ones at the same places are "nice to have". */
export const SMALL_PURCHASE_EUR = 40;

/** Money moved to investments or between own accounts: not spending. */
export function isNonSpending(tx: Transaction): boolean {
  return (
    tx.type === 'investment_deposit' ||
    tx.type === 'salary_sweep' ||
    tx.category === 'Invest Deposit' ||
    tx.category === 'Salary Sweep'
  );
}

export function defaultBasketForTx(tx: Transaction): BasketKey {
  const abs = Math.abs(tx.amount);
  const small = abs <= SMALL_PURCHASE_EUR;
  // Kiosk / convenience store: a snack is a slip, a bigger run is groceries.
  if (tx.mcc === '5499') return small ? 'slips' : 'mandatory_regular';
  if (
    tx.category === 'Housing' ||
    tx.category === 'Utilities' ||
    tx.category === 'Groceries' ||
    tx.mcc === '4111' ||
    tx.mcc === '5541' ||
    tx.mcc === '5542'
  ) {
    return 'mandatory_regular';
  }
  if (tx.category === 'Health' || tx.category === 'Home & Tech') {
    return 'mandatory_irregular';
  }
  // Things you could live without if money got tight.
  if (tx.category === 'Travel' || tx.category === 'Entertainment' || tx.category === 'Lifestyle') {
    return 'nice_to_have';
  }
  // Cafés, restaurants, bars and taxis: small = slip, big = a nice-to-have.
  if (tx.category === 'Restaurants' || tx.mcc === '4121') {
    return small ? 'slips' : 'nice_to_have';
  }
  return 'slips';
}

export function resolveTxBasket(
  tx: Transaction,
  overrides: LabelOverride[],
): { basket: BasketKey; customLabel?: string } {
  const byTx = overrides.find((o) => o.txId === tx.id);
  if (byTx) return { basket: byTx.basket, customLabel: byTx.customLabel };

  const byMerchant = overrides.find((o) => o.merchantId === tx.merchantId);
  if (byMerchant) {
    return { basket: byMerchant.basket, customLabel: byMerchant.customLabel };
  }

  return { basket: defaultBasketForTx(tx) };
}

export function getLatestMonthKey(transactions: Transaction[]): string {
  const dates = transactions.map((t) => t.date.slice(0, 7)).sort();
  return dates[dates.length - 1] ?? '2026-09';
}

export function filterTransactions(
  transactions: Transaction[],
  includePsd2: boolean,
  monthKey?: string,
): Transaction[] {
  return transactions.filter((tx) => {
    if (!includePsd2 && tx.source === 'psd2_external') return false;
    if (monthKey && !tx.date.startsWith(monthKey)) return false;
    return true;
  });
}

export function computeBaskets(
  transactions: Transaction[],
  overrides: LabelOverride[],
  monthKey?: string,
): BasketSummary {
  const targetMonth = monthKey ?? getLatestMonthKey(transactions);
  const summary: BasketSummary = {
    mandatory_regular: 0,
    mandatory_irregular: 0,
    slips: 0,
    nice_to_have: 0,
    totalSpend: 0,
    income: 0,
    saved: 0,
  };

  for (const tx of transactions) {
    if (!tx.date.startsWith(targetMonth)) continue;
    if (tx.amount > 0) {
      summary.income += tx.amount;
      continue;
    }
    const abs = Math.abs(tx.amount);
    if (isNonSpending(tx)) {
      summary.saved += abs;
      continue;
    }
    const { basket } = resolveTxBasket(tx, overrides);
    summary[basket] += abs;
    summary.totalSpend += abs;
  }

  summary.mandatory_regular = round2(summary.mandatory_regular);
  summary.mandatory_irregular = round2(summary.mandatory_irregular);
  summary.slips = round2(summary.slips);
  summary.nice_to_have = round2(summary.nice_to_have);
  summary.totalSpend = round2(summary.totalSpend);
  summary.income = round2(summary.income);
  summary.saved = round2(summary.saved);
  return summary;
}

// ---------------------------------------------------------------------------
// Emergency fund and money mood
// ---------------------------------------------------------------------------

export const EMERGENCY_FUND_MONTHS = 3;

function monthKeys(transactions: Transaction[]): string[] {
  return [...new Set(transactions.map((t) => t.date.slice(0, 7)))].sort();
}

function sortedTxs(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

/**
 * Emergency fund: money on the account covering 3 months of money going out
 * (average of the last 12 months). Investments don't count: not instant cash.
 */
export function computeEmergencyFund(
  transactions: Transaction[],
  overrides: LabelOverride[] = [],
  monthKey?: string,
): EmergencyFund {
  const months = monthKeys(transactions);
  const month = monthKey ?? months[months.length - 1] ?? '2026-09';
  const i = Math.max(0, months.indexOf(month));
  const window = months.slice(Math.max(0, i - 11), i + 1);
  const sums = window.map((m) => computeBaskets(transactions, overrides, m));
  const n = Math.max(1, sums.length);
  const monthlyOutgoings = sums.reduce((a, s) => a + s.totalSpend, 0) / n;
  const monthlyPay = sums.reduce((a, s) => a + s.income, 0) / n;
  const inMonth = sortedTxs(transactions).filter((t) => t.date.slice(0, 7) <= month);
  const balance = inMonth.length ? inMonth[inMonth.length - 1].balanceAfter : 0;
  const target = monthlyOutgoings * EMERGENCY_FUND_MONTHS;
  const monthsCovered = monthlyOutgoings > 0 ? balance / monthlyOutgoings : 0;
  return {
    month,
    goalMonths: EMERGENCY_FUND_MONTHS,
    monthlyOutgoings: round2(monthlyOutgoings),
    target: round2(target),
    alternativeTargetPay: round2(monthlyPay * EMERGENCY_FUND_MONTHS),
    balance: round2(balance),
    monthsCovered: round2(monthsCovered),
    progressPct: target > 0 ? Math.max(0, Math.min(100, Math.round((balance / target) * 100))) : 0,
    missing: round2(Math.max(0, target - balance)),
    status: monthsCovered >= EMERGENCY_FUND_MONTHS ? 'reached' : monthsCovered >= 1 ? 'building' : 'low',
  };
}

/**
 * Purchases you couldn't really afford: a slip or nice-to-have that left less
 * money than the rent and bills still due before the next income, or that took
 * the account below zero.
 */
export function detectRiskyPurchases(
  transactions: Transaction[],
  overrides: LabelOverride[] = [],
): RiskyPurchase[] {
  const txs = sortedTxs(transactions);
  const isBill = (t: Transaction) => t.amount < 0 && (t.category === 'Housing' || t.category === 'Utilities');
  const out: RiskyPurchase[] = [];
  txs.forEach((t, i) => {
    if (t.amount >= 0 || isNonSpending(t)) return;
    const { basket, customLabel } = resolveTxBasket(t, overrides);
    if (basket !== 'slips' && basket !== 'nice_to_have') return;
    let due = 0;
    const limit = addDays(t.date, 31);
    for (let j = i + 1; j < txs.length; j++) {
      const u = txs[j];
      if (u.amount > 0 && !isNonSpending(u)) break; // next income
      if (u.date > limit) break;
      if (isBill(u)) due += Math.abs(u.amount);
    }
    if (t.balanceAfter < 0 || t.balanceAfter < due) {
      out.push({
        txId: t.id,
        date: t.date,
        label: customLabel || t.merchantType || t.category,
        basket,
        amount: round2(Math.abs(t.amount)),
        balanceAfter: round2(t.balanceAfter),
        billsDueBeforeIncome: round2(due),
      });
    }
  });
  return out;
}

const MOOD_FACE: Record<MoneyMoodLevel, MentorMood> = {
  angry: 'bluff_caught',
  mild: 'suspicious',
  happy: 'impressed',
};

/** How this month's decisions look: happy, mild or angry, with the reasons. */
export function computeMoneyMood(
  transactions: Transaction[],
  overrides: LabelOverride[] = [],
  monthKey?: string,
): MoneyMood {
  const months = monthKeys(transactions);
  const month = monthKey ?? months[months.length - 1] ?? '2026-09';
  const i = Math.max(0, months.indexOf(month));
  const s = computeBaskets(transactions, overrides, month);
  const prior = months.slice(Math.max(0, i - 12), i).map((m) => computeBaskets(transactions, overrides, m));
  const prevSlips = prior.length ? prior.reduce((a, x) => a + x.slips, 0) / prior.length : s.slips;
  const ef = computeEmergencyFund(transactions, overrides, month);
  const risky = detectRiskyPurchases(transactions, overrides).filter((r) => r.date.startsWith(month));
  const negativeDays = new Set(
    transactions.filter((t) => t.date.startsWith(month) && t.balanceAfter < 0).map((t) => t.date),
  ).size;
  const net = s.income - s.totalSpend;
  const savingsRate = s.income > 0 ? net / s.income : null;
  const e0 = (v: number) => `€${Math.round(v).toLocaleString('en-IE')}`;

  const bad: string[] = [];
  const meh: string[] = [];
  const good: string[] = [];
  if (risky.length) {
    const withBills = risky.filter((r) => r.balanceAfter >= 0 && r.billsDueBeforeIncome > r.balanceAfter);
    const n = `${risky.length} purchase${risky.length > 1 ? 's' : ''} you couldn't really afford`;
    if (withBills.length) {
      const w = withBills.reduce((a, b) => (b.billsDueBeforeIncome - b.balanceAfter > a.billsDueBeforeIncome - a.balanceAfter ? b : a));
      bad.push(`${n}: ${w.label} for ${e0(w.amount)} on ${w.date} left ${e0(w.balanceAfter)} with ${e0(w.billsDueBeforeIncome)} of rent and bills still due`);
    } else {
      const w = risky.reduce((a, b) => (b.balanceAfter < a.balanceAfter ? b : a));
      bad.push(`${n}: ${w.label} for ${e0(w.amount)} on ${w.date} took the balance to ${e0(w.balanceAfter)}`);
    }
  }
  if (negativeDays) bad.push(`account in the red on ${negativeDays} day${negativeDays > 1 ? 's' : ''}`);

  // Seasons: in a month when all of Finland spends more (Christmas, summer),
  // a rise within that normal seasonal bump isn't held against you.
  const seasonF = seasonalFactor(month);
  const busy = seasonF >= 1.05;
  const seasonPct = Math.round((seasonF - 1) * 100);
  const mName = monthLabel(month);
  const prevSpend = prior.length ? prior.reduce((a, x) => a + x.totalSpend, 0) / prior.length : s.totalSpend;
  let season: string | undefined;
  if (s.income > 0 && net < 0) {
    const allowance = busy ? prevSpend * (seasonF - 1) : 0;
    if (-net <= allowance) {
      season = `You spent ${e0(-net)} more than came in, but ${mName} is a busy month: Finns spend about ${seasonPct}% more than usual, so that's within the normal seasonal rise.`;
    } else {
      meh.push(`spent ${e0(-net)} more than came in${busy ? `, more than the usual ${seasonPct}% ${mName} rise` : ''}`);
    }
  }
  if (ef.monthsCovered < 1) meh.push(`no real emergency fund yet (goal: ${EMERGENCY_FUND_MONTHS} months, ${e0(ef.target)})`);
  const jumped = (factor: number) => prior.length > 0 && s.slips > prevSlips * 1.5 * factor && s.slips - prevSlips * factor > 50;
  if (jumped(Math.max(1, seasonF))) {
    meh.push(`small slips jumped to ${e0(s.slips)} (usually ${e0(prevSlips)})`);
  } else if (jumped(1) && busy) {
    season ??= `Your small slips rose to ${e0(s.slips)} (usually ${e0(prevSlips)}), but ${mName} is a busy month in Finland, so I'm not counting it against you.`;
  }
  if (savingsRate != null && savingsRate >= 0 && savingsRate < 0.05) meh.push('almost nothing left over to save');
  if (ef.status === 'reached') good.push(`emergency fund covers ${Math.floor(ef.monthsCovered)} months: goal reached`);
  else if (ef.status === 'building') good.push(`emergency fund at ${ef.progressPct}% of the ${EMERGENCY_FUND_MONTHS}-month goal`);
  if (savingsRate != null && savingsRate >= 0.2) good.push(`kept ${Math.round(savingsRate * 100)}% of income`);
  if (s.saved > 0) good.push(`moved ${e0(s.saved)} to investments`);
  if (!risky.length && s.slips + s.nice_to_have > 0) good.push('every treat was within your means');

  const level: MoneyMoodLevel = bad.length ? 'angry' : meh.length ? 'mild' : 'happy';
  // 0-100, banded so it always agrees with the mood: angry 0-35, mild 36-69, happy 70-100.
  const raw = 55 + (savingsRate ?? 0) * 80 - 12 * meh.length - 4 * Math.min(5, risky.length) + (ef.progressPct / 100) * 15;
  const [lo, hi] = level === 'angry' ? [0, 35] : level === 'mild' ? [36, 69] : [70, 100];
  const score = Math.round(Math.max(lo, Math.min(hi, level === 'angry' ? raw - 50 : raw)));
  const headline =
    level === 'angry'
      ? `Rent money went on treats. ${capitalise(bad[0])}.`
      : level === 'mild'
        ? `Not bad, but: ${meh[0]}.`
        : `Living within your means. ${capitalise(good[0] ?? 'Nice work')}.`;
  return { month, level, mentorMood: MOOD_FACE[level], score, headline, reasons: { bad, meh, good }, risky, emergency: ef, season };
}

// ---------------------------------------------------------------------------
// Seasons: Finland's month-by-month spending pattern (Statistics Finland)
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabel(monthKey: string): string {
  return MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1] ?? monthKey;
}

function addMonths(monthKey: string, n: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Finland's seasonal factor for a month: 1.14 = shops sell 14% more than in an average month. */
export function seasonalFactor(monthKey: string, series: SeasonSeries = 'retail'): number {
  const idx = SEASONALITY.series[series].profile[Number(monthKey.slice(5, 7)) - 1];
  return idx ? idx / 100 : 1;
}

/**
 * Look one and two months ahead: is a busy spending season coming? Picks the
 * most striking one (Christmas, Black Friday, summer, renovation season...).
 */
/**
 * How much more the average Finn spends per month in October–December than in
 * January–March (quarterly national accounts), rounded to €10.
 */
export function christmasQuarterGap(): number {
  const q = SEASONALITY.household.perPersonMonthByQuarter;
  return Math.round((q[3] - q[0]) / 10) * 10;
}

export function seasonalHeadsUp(monthKey: string): SeasonHeadsUp | null {
  const candidates: { series: SeasonSeries; min: number; weight?: number; title: (m: string) => string; text: (m: string, pct: number) => string }[] = [
    {
      series: 'retail', min: 110, weight: 2.5, // all shops: affects everyone, so it outranks single categories
      title: (m) => (m === 'December' ? 'Christmas is coming' : `${m} is a big shopping month`),
      text: (m, p) => {
        const gap = christmasQuarterGap();
        const euros = m === 'December' && gap > 0
          ? ` In October–December the average Finn spends about €${gap} a month more than in January–March.`
          : '';
        return `${m} is coming: shops in Finland sell about ${p}% more than in an average month.${euros} Putting a little aside now keeps it from hitting your budget.`;
      },
    },
    {
      series: 'electronics', min: 120,
      title: (m) => (m === 'November' ? 'Black Friday is coming' : `${m}: gadget season`),
      text: (m, p) => `${m === 'November' ? 'Black Friday is coming' : `${m} is coming`}: electronics sales in Finland jump about ${p}% above a normal month. Decide what you actually need before the deals start.`,
    },
    {
      series: 'hotels', min: 115,
      title: () => 'Holiday season ahead',
      text: (m, p) => `${m} is holiday season: Finns spend about ${p}% more on hotels and trips. If you're planning one, start a small travel pot now.`,
    },
    {
      series: 'home', min: 115,
      title: () => 'Home and garden season',
      text: (m, p) => `${m} is home and garden season: sales of home equipment run about ${p}% above normal. Good time to plan before you buy.`,
    },
    {
      series: 'restaurants', min: 110,
      title: () => 'Terrace season',
      text: (m, p) => `${m} is terrace season: Finns spend about ${p}% more in restaurants and cafés. Easy month for slips to add up.`,
    },
  ];
  let best: SeasonHeadsUp | null = null;
  let bestScore = 0;
  for (const ahead of [1, 2]) {
    const m = addMonths(monthKey, ahead);
    const name = monthLabel(m);
    for (const c of candidates) {
      const idx = SEASONALITY.series[c.series].profile[Number(m.slice(5, 7)) - 1];
      // prefer the nearer month a little
      const score = ((idx - c.min) / c.min) * (c.weight ?? 1) - (ahead - 1) * 0.02;
      if (idx >= c.min && score > bestScore) {
        bestScore = score;
        best = { month: m, key: c.series, index: idx, title: c.title(name), text: c.text(name, idx - 100) };
      }
    }
  }
  return best;
}

/**
 * Your spending pattern over the calendar year next to Finland's: each month
 * against your own average month (100), from all the data there is.
 */
export function computeSeasonCompare(transactions: Transaction[], overrides: LabelOverride[] = []): Extract<ChartPayload, { kind: 'season_compare' }> {
  const byCal: number[][] = Array.from({ length: 12 }, () => []);
  for (const m of monthKeys(transactions)) {
    byCal[Number(m.slice(5, 7)) - 1].push(computeBaskets(transactions, overrides, m).totalSpend);
  }
  const avgs = byCal.map((v) => (v.length ? v.reduce((a, x) => a + x, 0) / v.length : null));
  const known = avgs.filter((v): v is number => v != null);
  const mean = known.reduce((a, v) => a + v, 0) / Math.max(1, known.length);
  const fin = SEASONALITY.series.retail.profile;
  const rows = MONTH_NAMES.map((name, i) => ({
    label: name.slice(0, 3),
    yours: avgs[i] != null && mean > 0 ? Math.round(((avgs[i] as number) / mean) * 100) : null,
    finland: fin[i],
  }));
  const peak = (vals: (number | null)[]) => {
    let bi = 0;
    vals.forEach((v, i) => { if ((v ?? -1) > (vals[bi] ?? -1)) bi = i; });
    return `${MONTH_NAMES[bi]} (${(vals[bi] ?? 100) >= 100 ? '+' : ''}${(vals[bi] ?? 100) - 100}%)`;
  };
  // Euros per month by quarter: your average month vs the average Finn's.
  const hh = SEASONALITY.household;
  const quarters = hh.quarters.map((label, qi) => {
    const yours = byCal.slice(qi * 3, qi * 3 + 3).flat();
    return {
      label,
      yours: yours.length ? Math.round(yours.reduce((a, x) => a + x, 0) / yours.length) : null,
      finland: hh.perPersonMonthByQuarter[qi],
    };
  });
  return {
    kind: 'season_compare',
    title: 'Your year vs Finland',
    months: rows,
    yourPeak: peak(rows.map((r) => r.yours)),
    finlandPeak: peak(rows.map((r) => r.finland)),
    source: `${SEASONALITY.source}, ${SEASONALITY.years[0]}–${SEASONALITY.years[SEASONALITY.years.length - 1]}`,
    quarters,
    quartersNote: `Average Finn: all household spending per person (children included), ${SEASONALITY.years[0]}–${SEASONALITY.years[SEASONALITY.years.length - 1]}. Source: Statistics Finland, quarterly national accounts.`,
  };
}

// ---------------------------------------------------------------------------
// Budget: monthly limits Mikko uses to steer you away from buys you'd regret
// ---------------------------------------------------------------------------

export const BUDGET_CATEGORIES = ['Restaurants', 'Entertainment', 'Lifestyle', 'Travel'] as const;

/** Mikko's suggestion: last 3 months' average, trimmed 10%, rounded to €10. */
export function suggestBudget(transactions: Transaction[], overrides: LabelOverride[] = []): Budget {
  const months = monthKeys(transactions);
  const recent = months.slice(-4, -1).length ? months.slice(-4, -1) : months.slice(-1);
  const sums = recent.map((m) => computeBaskets(transactions, overrides, m));
  const avg = (k: 'slips' | 'nice_to_have') => sums.reduce((a, s) => a + s[k], 0) / Math.max(1, sums.length);
  const trim = (v: number) => Math.max(10, Math.floor((v * 0.9) / 10) * 10);
  return { slips: trim(avg('slips')), nice_to_have: trim(avg('nice_to_have')), categories: {} };
}

function categorySpend(transactions: Transaction[], month: string, category: string): number {
  return transactions
    .filter((t) => t.date.startsWith(month) && t.amount < 0 && !isNonSpending(t) && t.category === category)
    .reduce((a, t) => a + Math.abs(t.amount), 0);
}

export function computeBudgetStatus(
  transactions: Transaction[],
  overrides: LabelOverride[],
  budget: Budget,
  monthKey?: string,
): BudgetStatus {
  const months = monthKeys(transactions);
  const month = monthKey ?? months[months.length - 1] ?? '2026-09';
  const inMonth = transactions.filter((t) => t.date.startsWith(month)).map((t) => t.date).sort();
  const today = inMonth[inMonth.length - 1] ?? `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Number(today.slice(8, 10)) || 1;
  const s = computeBaskets(transactions, overrides, month);

  const line = (key: string, label: string, limit: number, spent: number): BudgetLine => {
    const projected = (spent / day) * daysInMonth;
    const status: BudgetLine['status'] =
      spent > limit ? 'over' : spent >= limit * 0.8 || projected > limit * 1.05 ? 'close' : 'ok';
    return {
      key, label, limit: round2(limit), spent: round2(spent), left: round2(limit - spent),
      pct: limit > 0 ? Math.round((spent / limit) * 100) : 0, projected: round2(projected), status,
    };
  };
  const lines: BudgetLine[] = [];
  if (budget.slips > 0) lines.push(line('slips', 'Slips', budget.slips, s.slips));
  if (budget.nice_to_have > 0) lines.push(line('nice_to_have', 'Nice to have', budget.nice_to_have, s.nice_to_have));
  for (const [cat, limit] of Object.entries(budget.categories || {})) {
    if (limit > 0) lines.push(line(cat, cat, limit, categorySpend(transactions, month, cat)));
  }
  const rank = { over: 2, close: 1, ok: 0 } as const;
  const trouble = lines.filter((l) => l.status !== 'ok').sort((a, b) => rank[b.status] - rank[a.status] || b.pct - a.pct);
  return { month, today, daysLeft: Math.max(0, daysInMonth - day), lines, worst: trouble[0] ?? null };
}

/**
 * "Can I afford it?" Checks a planned purchase against the budget, the money
 * needed for bills until payday, and the emergency fund.
 */
export function checkPurchase(params: {
  transactions: Transaction[];
  overrides: LabelOverride[];
  budget: Budget | null;
  amount: number;
  category: string;
  what?: string;
}): PurchaseVerdict {
  const { transactions, overrides, budget, category } = params;
  const amount = Math.max(0, Number(params.amount) || 0);
  const what = params.what?.trim() || category.toLowerCase();
  const mcc = category === 'Restaurants' ? '5812' : category === 'Taxi' ? '4121' : '';
  const probe: Transaction = {
    id: 'probe', customerId: '', date: '', time: '12:00', category: category === 'Taxi' ? 'Transportation' : category,
    amount: -amount, balanceAfter: 0, merchantId: '', mcc, source: 'sbank',
  };
  const basket = defaultBasketForTx(probe);
  const e0 = (v: number) => `€${Math.round(v)}`;

  if (basket === 'mandatory_regular' || basket === 'mandatory_irregular') {
    return {
      verdict: 'go', mood: 'deadpan', basket,
      text: `${capitalise(what)} for ${e0(amount)} is a must-pay, not a treat. No budget check needed.`,
      reasons: ['mandatory'],
    };
  }

  const reasons: string[] = [];
  let verdict = 'go' as PurchaseVerdict['verdict'];
  const worse = (v: PurchaseVerdict['verdict']) => {
    if (v === 'stop' || (v === 'think' && verdict === 'go')) verdict = v;
  };

  // 1. Bill money until payday
  const safe = computeSafeToSpend(transactions, overrides, false);
  const freeAfterBills = safe.currentBalance - safe.reservedRegular - safe.surpriseBuffer;
  if (safe.currentBalance - amount < 0) {
    worse('stop');
    reasons.push(`you only have ${e0(safe.currentBalance)} on the account`);
  } else if (amount > freeAfterBills) {
    worse('stop');
    reasons.push(`it would eat into the ${e0(safe.reservedRegular + safe.surpriseBuffer)} set aside for bills and surprises`);
  } else if (amount > safe.safeWeekly) {
    worse('think');
    reasons.push(`it's more than your safe-to-spend this week (${e0(safe.safeWeekly)})`);
  }

  // 2. Budget
  if (budget) {
    const status = computeBudgetStatus(transactions, overrides, budget);
    const lines = status.lines.filter((l) => l.key === basket || l.key === probe.category);
    for (const l of lines) {
      if (amount > l.left) {
        worse(l.left <= 0 || amount > l.left + l.limit * 0.2 ? 'stop' : 'think');
        reasons.push(
          l.left <= 0
            ? `your ${l.label.toLowerCase()} budget is already used up (${e0(l.spent)} of ${e0(l.limit)})`
            : `only ${e0(l.left)} left in your ${l.label.toLowerCase()} budget (${e0(l.limit)}/month)`,
        );
      } else if (l.left - amount < l.limit * 0.1) {
        worse('think');
        reasons.push(`it would leave just ${e0(l.left - amount)} of your ${l.label.toLowerCase()} budget for ${status.daysLeft} days`);
      }
    }
  }

  // 3. Emergency fund
  const ef = computeEmergencyFund(transactions, overrides);
  if (basket === 'nice_to_have' && ef.status === 'low') {
    worse('think');
    reasons.push(`your emergency fund covers under a month (${ef.monthsCovered.toFixed(1)}), so that money could build your safety net`);
  }

  const mood: MentorMood = verdict === 'stop' ? 'bluff_caught' : verdict === 'think' ? 'suspicious' : 'impressed';
  const label = basket === 'slips' ? 'a slip' : 'a nice-to-have';
  const text =
    verdict === 'go'
      ? `${capitalise(what)} for ${e0(amount)}? That's ${label}, and it fits${budget ? ' your budget' : ''}. Go for it.`
      : verdict === 'think'
        ? `${capitalise(what)} for ${e0(amount)}: think twice. ${capitalise(reasons[0])}.`
        : `${capitalise(what)} for ${e0(amount)}: I'd skip it. ${capitalise(reasons[0])}.`;
  return { verdict, mood, basket, text, reasons };
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function detectSuspicionQuests(
  transactions: Transaction[],
  overrides: LabelOverride[],
  resolvedIds: string[],
  includePsd2: boolean,
): SuspicionQuest[] {
  const latestMonth = getLatestMonthKey(transactions);
  const visible = filterTransactions(transactions, includePsd2);
  const latest = visible.filter((t) => t.date.startsWith(latestMonth));
  const quests: SuspicionQuest[] = [];

  const isOverridden = (tx: Transaction) =>
    overrides.some((o) => o.txId === tx.id || o.merchantId === tx.merchantId);

  const labelFor = (tx: Transaction) => tx.merchantType || tx.merchantId;

  // 1. Repeating Lifestyle/Entertainment merchant
  const repeatCandidates = latest.filter(
    (t) =>
      t.amount < 0 &&
      (t.category === 'Lifestyle' || t.category === 'Entertainment') &&
      !isOverridden(t),
  );
  const seenMerchants = new Set<string>();
  for (const tx of repeatCandidates) {
    if (seenMerchants.has(tx.merchantId)) continue;
    seenMerchants.add(tx.merchantId);
    const history = visible.filter((v) => v.merchantId === tx.merchantId);
    const historyCount = history.length;
    const months = new Set(history.map((v) => v.date.slice(0, 7))).size;
    if (historyCount < 2 && months < 2) continue;
    const qId = `quest-repeat-${tx.merchantId}`;
    if (resolvedIds.includes(qId)) continue;
    if (quests.filter((q) => q.reason === 'mystery_repeat' || q.reason === 'psd2_hidden').length >= 4) break;
    quests.push({
      id: qId,
      txId: tx.id,
      merchantId: tx.merchantId,
      reason: tx.source === 'psd2_external' ? 'psd2_hidden' : 'mystery_repeat',
      amount: Math.abs(tx.amount),
      repeatCount: historyCount,
      repeatMonths: months,
      prompt:
        tx.source === 'psd2_external'
          ? `Found on your linked card: €${Math.abs(tx.amount).toFixed(2)} at ${labelFor(tx)}. Thought I wouldn't check?`
          : `€${Math.abs(tx.amount).toFixed(2)} to ${labelFor(tx)} (${historyCount} charges, ${months} mo). Bank says "${tx.category}". What is it actually?`,
      choices: [
        {
          id: 'streaming',
          label: 'Netflix / Streaming',
          customLabel: 'Netflix',
          basket: 'mandatory_regular',
          xp: 35,
          coins: 25,
        },
        {
          id: 'unused_sub',
          label: 'Membership I barely use',
          customLabel: 'Unused Sub',
          basket: 'slips',
          xp: 40,
          coins: 30,
        },
        {
          id: 'phone_plan',
          label: 'Phone / internet add-on',
          customLabel: 'Phone Plan',
          basket: 'mandatory_regular',
          xp: 25,
          coins: 15,
        },
      ],
    });
  }

  // 2. Late-night taxi or bar slip (00:00 - 04:59)
  const lateNight = latest.find(
    (t) =>
      t.amount < 0 &&
      (t.mcc === '4121' || t.category === 'Restaurants') &&
      Number.parseInt(t.time.slice(0, 2), 10) < 5 &&
      !isOverridden(t) &&
      !resolvedIds.includes(`quest-night-${t.id}`),
  );
  if (lateNight) {
    quests.push({
      id: `quest-night-${lateNight.id}`,
      txId: lateNight.id,
      merchantId: lateNight.merchantId,
      reason: 'late_night_slip',
      amount: Math.abs(lateNight.amount),
      prompt: `€${Math.abs(lateNight.amount).toFixed(2)} at ${lateNight.time.slice(0, 5)} on ${lateNight.date} (${labelFor(lateNight)}). Be honest: need or slip?`,
      choices: [
        {
          id: 'honest_slip',
          label: 'Night out — slipped',
          customLabel: 'Late-Night Taxi',
          basket: 'slips',
          xp: 30,
          coins: 20,
        },
        {
          id: 'work_shift',
          label: 'Late work / emergency',
          customLabel: 'Emergency Ride',
          basket: 'mandatory_irregular',
          xp: 15,
          coins: 10,
        },
        {
          id: 'claim_regular',
          label: 'Mandatory & Regular',
          customLabel: 'Regular Bill',
          basket: 'mandatory_regular',
          xp: 0,
          coins: 0,
        },
      ],
    });
  }

  // 3. Large Home & Tech spike (> €150)
  const techSpike = latest.find(
    (t) =>
      t.amount < 0 &&
      t.category === 'Home & Tech' &&
      Math.abs(t.amount) >= 150 &&
      !isOverridden(t) &&
      !resolvedIds.includes(`quest-spike-${t.id}`),
  );
  if (techSpike) {
    quests.push({
      id: `quest-spike-${techSpike.id}`,
      txId: techSpike.id,
      merchantId: techSpike.merchantId,
      reason: 'spike_anomaly',
      amount: Math.abs(techSpike.amount),
      prompt: `€${Math.abs(techSpike.amount).toFixed(2)} at ${labelFor(techSpike)} (Home & Tech). Broken appliance or impulse upgrade?`,
      choices: [
        {
          id: 'broken_appliance',
          label: 'Broken appliance (Mandatory)',
          customLabel: 'Appliance Repair',
          basket: 'mandatory_irregular',
          xp: 25,
          coins: 15,
        },
        {
          id: 'impulse_gadget',
          label: 'Impulse gadget (Be honest)',
          customLabel: 'Impulse Tech',
          basket: 'nice_to_have',
          xp: 40,
          coins: 30,
        },
      ],
    });
  }

  return quests;
}

export function resolveInterrogationChoice(params: {
  quest: SuspicionQuest;
  tx: Transaction;
  choiceId: string;
}): {
  accepted: boolean;
  bluffCaught: boolean;
  mood: MentorMood;
  mentorReply: string;
  xpEarned: number;
  coinsEarned: number;
  override?: LabelOverride;
} {
  const { quest, tx, choiceId } = params;
  const choice = quest.choices.find((c) => c.id === choiceId);
  if (!choice) {
    return {
      accepted: false,
      bluffCaught: false,
      mood: 'deadpan',
      mentorReply: 'Pick one of the answers.',
      xpEarned: 0,
      coinsEarned: 0,
    };
  }

  const hour = Number.parseInt(tx.time.slice(0, 2), 10);
  const isLateNightTaxiOrFood =
    (tx.mcc === '4121' || tx.mcc === '5814' || tx.category === 'Restaurants') &&
    hour < 5;

  if (isLateNightTaxiOrFood && choice.basket === 'mandatory_regular') {
    return {
      accepted: false,
      bluffCaught: true,
      mood: 'bluff_caught',
      mentorReply: `A ${tx.time} ride (MCC ${tx.mcc}) is not rent. Drop the excuse and take the +30 XP for honesty.`,
      xpEarned: 0,
      coinsEarned: 0,
    };
  }

  const isMerchantWide = quest.reason === 'mystery_repeat' || quest.reason === 'psd2_hidden';
  const isNetflix = choice.customLabel === 'Netflix' || choice.customLabel === 'Streaming';
  return {
    accepted: true,
    bluffCaught: false,
    mood: isNetflix ? 'pointing' : choice.xp >= 30 ? 'impressed' : 'deadpan',
    mentorReply: isNetflix
      ? `Logged as Netflix (€${quest.amount.toFixed(2)}/mo). Want to see what could have happened if you didn't use Netflix?`
      : `Logged "${choice.customLabel}" (+${choice.xp} XP, +${choice.coins}c). Baskets updated.`,
    xpEarned: choice.xp,
    coinsEarned: choice.coins,
    override: {
      merchantId: isMerchantWide ? tx.merchantId : undefined,
      txId: isMerchantWide ? undefined : tx.id,
      customLabel: choice.customLabel,
      basket: choice.basket,
    },
  };
}

export function computeSafeToSpend(
  transactions: Transaction[],
  overrides: LabelOverride[],
  includePsd2: boolean,
): {
  currentBalance: number;
  reservedRegular: number;
  surpriseBuffer: number;
  safeWeekly: number;
  dailyAllowance: number;
} {
  const visible = filterTransactions(transactions, includePsd2);
  const sorted = [...visible].sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
  );
  const latestTx = sorted[sorted.length - 1];
  const currentBalance = latestTx ? latestTx.balanceAfter : 0;

  const latestMonth = getLatestMonthKey(visible);
  const baskets = computeBaskets(visible, overrides, latestMonth);

  // Reserve 35% of monthly regular bills for upcoming cycle + 25% of irregular median
  const reservedRegular = round2(baskets.mandatory_regular * 0.35);
  const surpriseBuffer = round2(Math.max(80, baskets.mandatory_irregular * 0.4));
  const rawFree = Math.max(0, currentBalance - reservedRegular - surpriseBuffer);
  const safeWeekly = round2(rawFree / 3.2);
  const dailyAllowance = round2(safeWeekly / 7);

  return {
    currentBalance: round2(currentBalance),
    reservedRegular,
    surpriseBuffer,
    safeWeekly,
    dailyAllowance,
  };
}

export function simulateWhatIf(params: {
  monthlyAmount: number;
  months: number;
  asset: WhatIfAsset;
  title?: string;
}): WhatIfResult {
  const { monthlyAmount, months, asset, title } = params;
  const safeMonths = Math.max(1, Math.min(120, Math.round(months)));
  const points: WhatIfPoint[] = [];

  let cashPile = 0;
  let savingsValue = 0;
  let assetValue = 0;

  const monthlySavingsRate = 0.0275 / 12;

  for (let m = 1; m <= safeMonths; m++) {
    cashPile += monthlyAmount;
    savingsValue = (savingsValue + monthlyAmount) * (1 + monthlySavingsRate);

    let r = 0;
    if (asset === 'index_fund') {
      // Steady ~8.2% annual return with mild realistic market waves
      const wave = Math.sin(m * 0.65) * 0.011;
      r = 0.0068 + wave;
    } else if (asset === 'nokia') {
      // Volatile Finnish single-stock cycle including real drawdown periods
      const cycle = Math.sin(m * 0.55) * 0.055 + Math.cos(m * 0.25) * 0.028;
      r = -0.004 + cycle;
    } else {
      r = monthlySavingsRate;
    }

    assetValue = (assetValue + monthlyAmount) * (1 + r);

    // Sample points cleanly for SVG chart (every month if <= 24, else every N months + final)
    const step = safeMonths <= 24 ? 1 : Math.ceil(safeMonths / 18);
    if (m === 1 || m === safeMonths || m % step === 0) {
      points.push({
        monthIndex: m,
        label: safeMonths <= 24 ? `M${m}` : `${(m / 12).toFixed(1)}y`,
        cashPile: round2(cashPile),
        assetValue: round2(assetValue),
        savingsValue: round2(savingsValue),
      });
    }
  }

  const assetLabel =
    asset === 'index_fund'
      ? 'Global Index Fund (Default)'
      : asset === 'nokia'
        ? 'Nokia (NOKIA.HE)'
        : 'S-Savings (2.75%)';

  const finalAssetValue = round2(assetValue);
  const finalSavingsValue = round2(savingsValue);
  const totalCash = round2(cashPile);

  return {
    title: title ?? `€${monthlyAmount.toFixed(2)}/mo over ${safeMonths} months`,
    monthlyAmount: round2(monthlyAmount),
    months: safeMonths,
    asset,
    assetLabel,
    totalCash,
    finalAssetValue,
    finalSavingsValue,
    deltaVsCash: round2(finalAssetValue - totalCash),
    deltaVsSavings: round2(finalAssetValue - finalSavingsValue),
    points,
  };
}

export function answerFinanceQuery(params: {
  query: string;
  persona: PersonaConfig;
  transactions: Transaction[];
  overrides: LabelOverride[];
  includePsd2: boolean;
}): {
  text: string;
  mood: MentorMood;
  chart?: ChartPayload;
} {
  const { query, persona, transactions, overrides, includePsd2 } = params;
  const q = query.toLowerCase();
  const visible = filterTransactions(transactions, includePsd2);
  const latestMonth = getLatestMonthKey(visible);
  const latest = visible.filter((t) => t.date.startsWith(latestMonth));

  // 1. Taxis query
  if (q.includes('taxi') || q.includes('taksi') || q.includes('4121')) {
    const taxis = latest.filter((t) => t.mcc === '4121' && t.amount < 0);
    const total = round2(taxis.reduce((s, t) => s + Math.abs(t.amount), 0));
    const avgRide = taxis.length ? round2(total / taxis.length) : 0;

    // Monthly series across July-Sep
    const byMonth = ['2026-07', '2026-08', '2026-09'].map((m) => {
      const mTotal = visible
        .filter((t) => t.date.startsWith(m) && t.mcc === '4121' && t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      return {
        label: m.slice(5) === '07' ? 'Jul' : m.slice(5) === '08' ? 'Aug' : 'Sep',
        value: round2(mTotal),
        highlight: m === latestMonth,
      };
    });

    return {
      mood: total > 80 ? 'suspicious' : 'impressed',
      text:
        taxis.length === 0
          ? `Zero taxi charges in ${latestMonth}. Keep walking.`
          : `€${total.toFixed(2)} across ${taxis.length} taxi rides in ${latestMonth} (avg €${avgRide.toFixed(2)}/ride). ${total > 80 ? 'Almost all of it after midnight.' : 'Well within reason.'}`,
      chart: {
        kind: 'bar',
        title: 'Taxi Spend (MCC 4121)',
        subtitle: `${latestMonth} · €${total.toFixed(2)} across ${taxis.length} rides`,
        bars: byMonth,
      },
    };
  }

  // 2. Safe to spend
  if (q.includes('safe') || q.includes('week') || q.includes('spend')) {
    const safe = computeSafeToSpend(transactions, overrides, includePsd2);
    return {
      mood: safe.safeWeekly < 90 ? 'suspicious' : 'impressed',
      text: `Safe to spend this week: €${safe.safeWeekly.toFixed(2)} (€${safe.dailyAllowance.toFixed(2)}/day). I locked €${safe.reservedRegular.toFixed(0)} for upcoming bills and €${safe.surpriseBuffer.toFixed(0)} for surprises.`,
      chart: {
        kind: 'safe_to_spend',
        title: 'Weekly Safe-to-Spend Guardrail',
        ...safe,
      },
    };
  }

  // 3. Peer comparison (Statistics Finland)
  if (
    q.includes('peer') ||
    q.includes('average') ||
    q.includes('finland') ||
    q.includes('compare') ||
    q.includes('kind of spender')
  ) {
    const restaurants = round2(
      latest
        .filter((t) => t.category === 'Restaurants' && t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    );
    const transport = round2(
      latest
        .filter((t) => t.category === 'Transportation' && t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    );
    const groceries = round2(
      latest
        .filter((t) => t.category === 'Groceries' && t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    );
    const baskets = computeBaskets(visible, overrides, latestMonth);
    const flexible = round2(baskets.slips + baskets.nice_to_have);
    const b = persona.benchmark;

    return {
      mood: flexible > b.slipsAvg ? 'suspicious' : 'impressed',
      text:
        flexible > b.slipsAvg
          ? `Your slips and nice-to-haves are €${flexible.toFixed(0)}/mo vs. €${b.slipsAvg} for ${b.ageGroup} in ${b.city} (Stats Finland). Restaurants alone hit €${restaurants.toFixed(0)}.`
          : `You beat the ${b.city} ${b.ageGroup} average: €${flexible.toFixed(0)} in slips and nice-to-haves vs. €${b.slipsAvg} Finnish peer average.`,
      chart: {
        kind: 'peer_compare',
        title: `You vs. Stats Finland (${b.ageGroup}, ${b.city})`,
        subtitle: `${latestMonth} monthly spend comparison`,
        rows: [
          { category: 'Restaurants', yours: restaurants, finlandAvg: b.restaurantsAvg },
          { category: 'Transport', yours: transport, finlandAvg: b.transportAvg },
          { category: 'Groceries', yours: groceries, finlandAvg: b.groceriesAvg },
          { category: 'Slips + Nice', yours: flexible, finlandAvg: b.slipsAvg },
        ],
      },
    };
  }

  // 4. What-if / cutback / dining out / netflix / nokia / index
  if (
    q.includes('what if') ||
    q.includes('save') ||
    q.includes('netflix') ||
    q.includes('stream') ||
    q.includes('nokia') ||
    q.includes('index') ||
    q.includes('dining') ||
    q.includes('20%')
  ) {
    const asset: WhatIfAsset = q.includes('nokia') ? 'nokia' : 'index_fund';
    const isDining = q.includes('dining') || q.includes('restaurant') || q.includes('20%');

    let monthlyAmount = 14.99;
    let months = 36;
    let sourceLabel = 'Streaming bill replay (€14.99/mo)';

    if (isDining) {
      const diningTotal = latest
        .filter((t) => t.category === 'Restaurants' && t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      monthlyAmount = round2(Math.max(15, diningTotal * 0.2));
      months = 60;
      sourceLabel = `20% dining cutback (€${monthlyAmount.toFixed(2)}/mo · 5 yrs)`;
    }

    const res = simulateWhatIf({
      monthlyAmount,
      months,
      asset,
      title: sourceLabel,
    });

    const gain = res.deltaVsCash;
    return {
      mood: gain >= 0 ? 'impressed' : 'suspicious',
      text:
        asset === 'nokia'
          ? `Replaying €${monthlyAmount.toFixed(2)}/mo over ${months} mos in NOKIA.HE lands at €${res.finalAssetValue.toFixed(2)} vs. €${res.finalSavingsValue.toFixed(2)} in S-Savings. Single stocks swing—check the Index Fund toggle.`
          : `Redirecting €${monthlyAmount.toFixed(2)}/mo into a Global Index Fund for ${months} mos builds €${res.finalAssetValue.toFixed(2)} (€${gain >= 0 ? '+' : ''}${gain.toFixed(2)} over idle cash).`,
      chart: {
        kind: 'what_if',
        result: res,
        sourceLabel,
      },
    };
  }

  // Default fallback: 3-basket diagnostic
  const baskets = computeBaskets(visible, overrides, latestMonth);
  const slipPct = baskets.totalSpend
    ? Math.round((baskets.slips / baskets.totalSpend) * 100)
    : 0;
  return {
    mood: slipPct > 22 ? 'suspicious' : 'deadpan',
    text: `${latestMonth} total spend: €${baskets.totalSpend.toFixed(2)}. ${slipPct}% (€${baskets.slips.toFixed(2)}) slipped through your fingers; €${baskets.nice_to_have.toFixed(2)} went on nice-to-haves. Ask about taxis, peers, safe-to-spend, or a 20% cutback.`,
  };
}

export function purchaseOrEquipItem(
  progress: PlayerProgress,
  item: ShopItem,
): {
  ok: boolean;
  reason?: string;
  next: PlayerProgress;
  action: 'equipped' | 'bought_and_equipped' | 'locked';
} {
  const alreadyOwned = progress.unlockedItems.includes(item.id);
  if (!alreadyOwned) {
    if (progress.level < item.requiredLevel) {
      return {
        ok: false,
        reason: `Requires Level ${item.requiredLevel}`,
        next: progress,
        action: 'locked',
      };
    }
    if (progress.coins < item.coinCost) {
      return {
        ok: false,
        reason: `Needs ${item.coinCost} Coins`,
        next: progress,
        action: 'locked',
      };
    }
  }

  const next: PlayerProgress = {
    ...progress,
    coins: alreadyOwned ? progress.coins : progress.coins - item.coinCost,
    unlockedItems: alreadyOwned
      ? progress.unlockedItems
      : [...progress.unlockedItems, item.id],
    equippedStyle:
      item.slot === 'mentor_style'
        ? (item.value as PlayerProgress['equippedStyle'])
        : progress.equippedStyle,
    equippedTheme:
      item.slot === 'app_theme'
        ? (item.value as PlayerProgress['equippedTheme'])
        : progress.equippedTheme,
    equippedCardSkin:
      item.slot === 'card_skin'
        ? (item.value as PlayerProgress['equippedCardSkin'])
        : progress.equippedCardSkin,
  };

  return {
    ok: true,
    next,
    action: alreadyOwned ? 'equipped' : 'bought_and_equipped',
  };
}

export function getShopItemById(id: string): ShopItem | undefined {
  return SHOP_CATALOG.find((item) => item.id === id);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
