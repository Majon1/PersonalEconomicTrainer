// Shared finance engine: used by the dashboard (browser) and by the chat
// tools (Node server), so both always give the same numbers.
// Pure ES module - no browser or Node APIs.

export const BASKETS = {
  regular: {
    name: "Mandatory & regular",
    short: "Regular",
    why: "Bills that come every month: rent, utilities, groceries, commuting. Predictable, so plan them first.",
  },
  irregular: {
    name: "Mandatory & irregular",
    short: "Irregular",
    why: "Necessary but unpredictable: the doctor, the pharmacy, a broken washing machine.",
  },
  everyday: {
    name: "Slips through your fingers",
    short: "Everyday",
    why: "Coffees, quick lunches, snacks, taxis, parking. Small and frequent, so you barely notice them, but they add up.",
  },
  extras: {
    name: "Nice to have",
    short: "Extras",
    why: "Travel, hobbies, events, shopping, dinners out. Not wrong, just the things you could live without if money got tight.",
  },
};
export const SPEND_KEYS = ["regular", "irregular", "everyday", "extras"];
export const SMALL_PURCHASE_EUR = 40;

const DAY = 86400000;
const r2 = (v) => Math.round(v * 100) / 100;
const toTime = (d) => Date.parse(`${d}T00:00:00Z`);
const toDate = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d, n) => toDate(toTime(d) + n * DAY);
const daysBetween = (a, b) => Math.round((toTime(b) - toTime(a)) / DAY) + 1; // inclusive
const monthEnd = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return toDate(Date.UTC(y, m, 0));
};
const prevMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return toDate(Date.UTC(y, m - 2, 1)).slice(0, 7);
};
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const mondayOf = (d) => addDays(d, -((weekday(d) + 6) % 7));

export function describe(t) {
  switch (t.type) {
    case "salary": return "Salary";
    case "other_income": return "Other income";
    case "investment_deposit": return "Moved to investments";
    case "investment_withdrawal": return "Withdrawn from investments";
    case "salary_sweep": return "Salary sweep";
    case "housing_payment": return "Rent / housing";
    case "utilities_payment": return "Utility bill";
    default: return t.merchantType || t.category;
  }
}

/**
 * @param data      customer.json contents
 * @param options   { overrides: {"cat:Travel": "irregular", "mt:Taxi": "regular"}, benchmarks }
 */
/** Built-in basket of each category (its most common basket in the raw data). */
export function defaultCategoryBaskets(transactions) {
  const c = {};
  for (const t of transactions) {
    if (!SPEND_KEYS.includes(t.basket)) continue;
    c[t.category] ??= {};
    c[t.category][t.basket] = (c[t.category][t.basket] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(c).map(([cat, n]) => [cat, Object.entries(n).sort((a, b) => b[1] - a[1])[0][0]]));
}

/**
 * Basket after the user's own rules:
 *  overrides["mt:<merchant type>"] = basket | "category" (follow the category)
 *  overrides["cat:<category>"]     = basket
 * Built-in merchant-type exceptions (e.g. taxis = everyday) stay unless the user changes them.
 */
export function applyRules(t, overrides, catDefault) {
  if (!SPEND_KEYS.includes(t.basket)) return t.basket;
  const mt = overrides[`mt:${t.merchantType}`];
  const cat = overrides[`cat:${t.category}`] || catDefault[t.category] || t.basket;
  if (mt === "category") return cat;
  if (mt) return mt;
  if (t.basket !== catDefault[t.category]) return t.basket; // built-in exception
  return cat;
}

export function createEngine(data, { overrides = {}, benchmarks = null } = {}) {
  const catDefault = defaultCategoryBaskets(data.transactions);
  const txs = data.transactions.map((t) => {
    const basket = applyRules(t, overrides, catDefault);
    return { ...t, basket, spend: SPEND_KEYS.includes(basket) ? -t.amount : 0 };
  });
  const firstDate = txs[0].date;
  const today = txs[txs.length - 1].date; // "now" = the last day with data
  const months = [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort();

  // Label for grouping spending: category, or the merchant type when a
  // merchant type sits in a different basket from the rest of its category.
  const catBasket = {};
  {
    const c = {};
    for (const t of txs) {
      if (!t.spend) continue;
      c[t.category] ??= {};
      c[t.category][t.basket] = (c[t.category][t.basket] || 0) + 1;
    }
    for (const [cat, counts] of Object.entries(c)) {
      catBasket[cat] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
  }
  // merchant types split across baskets by purchase size get a size hint
  const mtBaskets = {};
  for (const t of txs) if (t.spend && t.merchantType) (mtBaskets[t.merchantType] ??= new Set()).add(t.basket);
  const label = (t) => {
    if (catBasket[t.category] === t.basket || !t.merchantType) return t.category;
    if (mtBaskets[t.merchantType]?.size > 1) {
      return `${t.merchantType} (${t.spend <= SMALL_PURCHASE_EUR ? "small" : `over ${SMALL_PURCHASE_EUR} €`})`;
    }
    return t.merchantType;
  };

  const categories = [...new Set(txs.map((t) => t.category))].sort();
  const merchantTypes = [...new Set(txs.filter((t) => t.merchantType).map((t) => t.merchantType))].sort();

  // ---------- periods ----------
  function resolvePeriod(period = "all", start, end) {
    if (start || end) return { start: start || firstDate, end: end || today, label: `${start || firstDate} to ${end || today}` };
    const ym = today.slice(0, 7);
    const p = String(period).toLowerCase();
    let s, e = today, lbl = p.replace(/_/g, " ");
    if (/^\d{4}-\d{2}$/.test(p)) { s = `${p}-01`; e = monthEnd(p) < today ? monthEnd(p) : today; lbl = p; }
    else if (/^\d{4}$/.test(p)) { s = `${p}-01-01`; e = `${p}-12-31` < today ? `${p}-12-31` : today; lbl = p; }
    else if (p === "this_month") s = `${ym}-01`;
    else if (p === "last_month") { const pm = prevMonth(ym); s = `${pm}-01`; e = monthEnd(pm); lbl = `last month (${pm})`; }
    else if (p === "this_week") s = mondayOf(today);
    else if (p === "last_week") { e = addDays(mondayOf(today), -1); s = addDays(e, -6); }
    else if (p === "year_to_date") s = `${today.slice(0, 4)}-01-01`;
    else if (/^last_(\d+)_days$/.test(p)) s = addDays(today, -(Number(p.match(/\d+/)[0]) - 1));
    else if (/^last_(\d+)_months$/.test(p)) {
      // N calendar months including the current one, so charts never start with a sliver of a month
      const n = Number(p.match(/\d+/)[0]);
      const [y, m] = ym.split("-").map(Number);
      s = toDate(Date.UTC(y, m - n, 1));
    } else { s = firstDate; lbl = "all data"; }
    if (s < firstDate) s = firstDate;
    return { start: s, end: e, label: lbl };
  }
  const monthsIn = (p) => daysBetween(p.start, p.end) / 30.4375;

  // ---------- filtering ----------
  function select({ period, start, end, categories: cats, merchant_types: mts, baskets, flow = "spending",
    min_amount, max_amount, weekdays, search } = {}) {
    const p = resolvePeriod(period, start, end);
    const lc = (a) => (a || []).map((x) => String(x).toLowerCase());
    const C = lc(cats), M = lc(mts), B = lc(baskets), W = lc(weekdays);
    const q = search ? String(search).toLowerCase() : null;
    const rows = txs.filter((t) => {
      if (t.date < p.start || t.date > p.end) return false;
      if (flow === "spending" && !t.spend) return false;
      if (flow === "income" && t.basket !== "income") return false;
      if (flow === "saving" && t.basket !== "saving") return false;
      if (C.length && !C.includes(t.category.toLowerCase())) return false;
      if (M.length && !M.includes((t.merchantType || "").toLowerCase())) return false;
      if (B.length && !B.includes(t.basket)) return false;
      if (W.length && !W.includes(WEEKDAYS[weekday(t.date)].toLowerCase())) return false;
      const a = Math.abs(t.amount);
      if (min_amount != null && a < min_amount) return false;
      if (max_amount != null && a > max_amount) return false;
      if (q && ![t.category, t.merchantType, t.merchant, describe(t)].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
    return { p, rows };
  }

  const KEYERS = {
    month: (t) => t.date.slice(0, 7),
    week: (t) => mondayOf(t.date),
    day: (t) => t.date,
    weekday: (t) => WEEKDAYS[weekday(t.date)],
    hour: (t) => t.time.slice(0, 2),
    category: (t) => t.category,
    label: label,
    merchant_type: (t) => t.merchantType || t.category,
    merchant: (t) => t.merchant || describe(t),
    basket: (t) => t.basket,
  };
  const value = (t) => (t.spend ? t.spend : Math.abs(t.amount));

  /** Flexible query used for "how much did I spend on X" style questions. */
  function query(args = {}) {
    const { p, rows } = select(args);
    const total = rows.reduce((a, t) => a + value(t), 0);
    const res = {
      period: p,
      flow: args.flow || "spending",
      total_eur: r2(total),
      transactions: rows.length,
      average_per_transaction_eur: rows.length ? r2(total / rows.length) : 0,
    };
    if (monthsIn(p) >= 1.5) res.monthly_average_eur = r2(total / monthsIn(p));
    const g = args.group_by;
    if (g && KEYERS[g]) {
      const m = new Map();
      for (const t of rows) {
        const k = KEYERS[g](t);
        const e = m.get(k) || { key: k, total_eur: 0, transactions: 0 };
        e.total_eur += value(t);
        e.transactions += 1;
        m.set(k, e);
      }
      let groups = [...m.values()].map((e) => ({ ...e, total_eur: r2(e.total_eur) }));
      if (g === "month") {
        // include empty months so trends are honest
        const all = months.filter((mm) => mm >= p.start.slice(0, 7) && mm <= p.end.slice(0, 7));
        groups = all.map((mm) => groups.find((x) => x.key === mm) || { key: mm, total_eur: 0, transactions: 0 });
      } else if (g === "weekday") {
        const order = [1, 2, 3, 4, 5, 6, 0].map((i) => WEEKDAYS[i]);
        groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      } else if (["week", "day", "hour"].includes(g)) groups.sort((a, b) => (a.key < b.key ? -1 : 1));
      else groups.sort((a, b) => b.total_eur - a.total_eur);
      res.group_by = g;
      const lim = args.limit || 40;
      // time series keep the most recent entries; rankings keep the top ones
      res.groups = ["month", "week", "day"].includes(g) ? groups.slice(-lim) : groups.slice(0, lim);
    }
    const n = Math.min(args.list_transactions ?? 5, 50);
    if (n > 0) {
      const sorted = args.sort === "recent" ? [...rows].reverse() : [...rows].sort((a, b) => value(b) - value(a));
      res[args.sort === "recent" ? "recent_transactions" : "largest_transactions"] = sorted.slice(0, n).map((t) => ({
        date: t.date, what: describe(t), category: t.category, basket: t.basket, amount_eur: r2(t.amount),
      }));
    }
    return res;
  }

  // ---------- month stats (dashboard) ----------
  function monthStats(month) {
    const s = { month, income: 0, saving: 0, regular: 0, irregular: 0, everyday: 0, extras: 0, count: {}, groups: {}, endBalance: null };
    for (const t of txs) {
      if (!t.date.startsWith(month)) continue;
      s.endBalance = t.balance;
      if (t.basket === "income") s.income += t.amount;
      else if (t.basket === "saving") s.saving += -t.amount;
      else if (t.spend) {
        s[t.basket] += t.spend;
        s.count[t.basket] = (s.count[t.basket] || 0) + 1;
        const key = `${t.basket}|${label(t)}`;
        s.groups[key] ??= { basket: t.basket, label: label(t), amount: 0, n: 0 };
        s.groups[key].amount += t.spend;
        s.groups[key].n += 1;
      }
    }
    s.spend = s.regular + s.irregular + s.everyday + s.extras;
    s.left = s.income - s.spend - s.saving;
    return s;
  }
  const MONTH_STATS = Object.fromEntries(months.map((m) => [m, monthStats(m)]));

  // Averages over a rolling window, per month.
  function averages(period = "last_12_months") {
    const p = resolvePeriod(period);
    const n = monthsIn(p);
    const a = { period: p, income: 0, saving: 0, regular: 0, irregular: 0, everyday: 0, extras: 0 };
    for (const t of txs) {
      if (t.date < p.start || t.date > p.end) continue;
      if (t.basket === "income") a.income += t.amount;
      else if (t.basket === "saving") a.saving -= t.amount;
      else if (t.spend) a[t.basket] += t.spend;
    }
    for (const k of ["income", "saving", ...SPEND_KEYS]) a[k] = r2(a[k] / n);
    a.spend = r2(a.regular + a.irregular + a.everyday + a.extras);
    return a;
  }

  // ---------- mood: how your financial decisions look ----------
  // A "risky" purchase is a flexible one (everyday or extras) that leaves you
  // with less than the rent and bills still due before your next income, or
  // that takes the balance below zero.
  const isIncome = (t) => t.basket === "income";
  const isBill = (t) => t.type === "housing_payment" || t.type === "utilities_payment";
  const risky = [];
  txs.forEach((t, i) => {
    if (t.basket !== "everyday" && t.basket !== "extras") return;
    let due = 0, nextIncome = null;
    for (let j = i + 1; j < txs.length; j++) {
      const u = txs[j];
      if (isIncome(u)) { nextIncome = u.date; break; }
      if (u.date > addDays(t.date, 31)) break;
      if (isBill(u)) due -= u.amount;
    }
    if (t.balance < 0 || t.balance < due) {
      risky.push({
        date: t.date, what: describe(t), basket: t.basket, amount_eur: r2(-t.amount),
        balance_after_eur: r2(t.balance), bills_due_before_next_income_eur: r2(due), next_income: nextIncome,
      });
    }
  });

  /** Mood for one month: happy, mild or angry, with the reasons behind it. */
  function mood(month = months[months.length - 1]) {
    if (!MONTH_STATS[month]) return { error: `No data for ${month}` };
    const s = MONTH_STATS[month];
    const i = months.indexOf(month);
    const prior = months.slice(Math.max(0, i - 12), i).map((m) => MONTH_STATS[m]);
    const avg = (k) => (prior.length ? prior.reduce((a, x) => a + x[k], 0) / prior.length : s[k]);
    const mandatory = avg("regular") + avg("irregular") || s.regular + s.irregular;
    const flex = s.everyday + s.extras;
    const net = s.income - s.spend;
    const savingsRate = s.income > 0 ? net / s.income : null;
    const buffer = mandatory ? s.endBalance / mandatory : null;
    const monthRisky = risky.filter((r) => r.date.startsWith(month));
    const negativeDays = new Set(txs.filter((t) => t.date.startsWith(month) && t.balance < 0).map((t) => t.date)).size;

    const bad = [], meh = [], good = [];
    const e0 = (v) => `${Math.round(v).toLocaleString("en-IE")} €`;
    const day = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    if (monthRisky.length) {
      // prefer an example where rent/bills were still due; else the deepest overdraft
      const billCases = monthRisky.filter((r) => r.bills_due_before_next_income_eur > r.balance_after_eur && r.balance_after_eur >= 0);
      const n = `${monthRisky.length} purchase${monthRisky.length > 1 ? "s" : ""} you couldn't really afford`;
      if (billCases.length) {
        const w = billCases.reduce((a, b) => (b.bills_due_before_next_income_eur - b.balance_after_eur > a.bills_due_before_next_income_eur - a.balance_after_eur ? b : a));
        bad.push(`${n}, e.g. ${w.what} for ${e0(w.amount_eur)} on ${day(w.date)} left you ${e0(w.balance_after_eur)} with ${e0(w.bills_due_before_next_income_eur)} of rent and bills still to pay`);
      } else {
        const w = monthRisky.reduce((a, b) => (b.balance_after_eur < a.balance_after_eur ? b : a));
        bad.push(`${n}, e.g. ${w.what} for ${e0(w.amount_eur)} on ${day(w.date)} took your balance to ${e0(w.balance_after_eur)}`);
      }
    }
    if (negativeDays && flex > 0) bad.push(`your account was in the red on ${negativeDays} day${negativeDays > 1 ? "s" : ""}`);
    if (s.income > 0 && net < 0) meh.push(`you spent ${e0(-net)} more than came in`);
    if (buffer != null && buffer < 1 && !bad.length) meh.push(`your balance covers less than one month of must-pay costs`);
    const prevEveryday = avg("everyday");
    if (prior.length && s.everyday > prevEveryday * 1.5 && s.everyday - prevEveryday > 50) {
      meh.push(`small everyday purchases jumped to ${e0(s.everyday)} (usually about ${e0(prevEveryday)})`);
    }
    if (savingsRate != null && savingsRate >= 0 && savingsRate < 0.05) meh.push(`almost nothing left over to save`);
    if (savingsRate != null && savingsRate >= 0.2) good.push(`you kept ${Math.round(savingsRate * 100)}% of your income`);
    if (s.saving > 0) good.push(`you moved ${e0(s.saving)} to investments`);
    if (!monthRisky.length && flex > 0) good.push(`every treat was within your means`);
    if (buffer != null && buffer >= 3) good.push(`your buffer covers ${Math.floor(buffer)} months of must-pay costs`);

    const level = bad.length ? "angry" : meh.length ? "mild" : "happy";
    // 0-100 for later gamification; banded so it always agrees with the mood:
    // angry 0-35, mild 36-69, happy 70-100.
    const raw = 60 + (savingsRate ?? 0) * 80 - 12 * meh.length - 4 * Math.min(5, monthRisky.length)
      + (buffer != null ? Math.min(10, buffer * 2) : 0);
    const [lo, hi] = { angry: [0, 35], mild: [36, 69], happy: [70, 100] }[level];
    const score = Math.round(Math.max(lo, Math.min(hi, level === "angry" ? raw - 50 : raw)));
    return {
      month,
      mood: level,
      score,
      reasons: { bad, meh, good },
      risky_purchases: monthRisky.slice(0, 10),
      risky_purchases_count: monthRisky.length,
      numbers: {
        income_eur: r2(s.income), spending_eur: r2(s.spend), flexible_spending_eur: r2(flex),
        savings_rate_pct: savingsRate != null ? Math.round(savingsRate * 100) : null,
        buffer_months: buffer != null ? r2(buffer) : null,
      },
    };
  }

  // ---------- where it really goes: small habitual purchases ----------
  /**
   * Habits in the "slips through your fingers" basket, grouped by merchant
   * type: how often, typical size, yearly cost and whether it is growing.
   */
  function habits({ period = "last_12_months", baskets = ["everyday"] } = {}) {
    const p = resolvePeriod(period);
    const n = monthsIn(p);
    const rows = txs.filter((t) => t.spend && baskets.includes(t.basket) && t.date >= p.start && t.date <= p.end);
    // recent 3 months vs. the 3 before, for trend
    const [y, m] = today.slice(0, 7).split("-").map(Number);
    const recentStart = toDate(Date.UTC(y, m - 3, 1));
    const prevStart = toDate(Date.UTC(y, m - 6, 1));
    const g = {};
    for (const t of txs) {
      if (!t.spend || !baskets.includes(t.basket) || t.date < prevStart) continue;
      const k = t.merchantType || t.category;
      g[k] ??= { label: k, n: 0, total: 0, recent: 0, previous: 0, amounts: [], weekdays: {} };
      if (t.date >= recentStart) g[k].recent += t.spend; else g[k].previous += t.spend;
    }
    for (const t of rows) {
      const k = t.merchantType || t.category;
      g[k] ??= { label: k, n: 0, total: 0, recent: 0, previous: 0, amounts: [], weekdays: {} };
      g[k].n += 1;
      g[k].total += t.spend;
      g[k].amounts.push(t.spend);
      const wd = WEEKDAYS[weekday(t.date)];
      g[k].weekdays[wd] = (g[k].weekdays[wd] || 0) + 1;
    }
    const total = rows.reduce((a, t) => a + t.spend, 0);
    const list = Object.values(g).filter((x) => x.n > 0).map((x) => {
      const sorted = [...x.amounts].sort((a, b) => a - b);
      const topDay = Object.entries(x.weekdays).sort((a, b) => b[1] - a[1])[0];
      return {
        habit: x.label,
        times_per_month: r2(x.n / n),
        typical_purchase_eur: r2(sorted[Math.floor(sorted.length / 2)]),
        monthly_eur: r2(x.total / n),
        yearly_eur: r2((x.total / n) * 12),
        share_of_basket_pct: total ? Math.round((x.total / total) * 100) : 0,
        trend_last_3_vs_previous_3_months_pct: x.previous ? Math.round(((x.recent - x.previous) / x.previous) * 100) : null,
        most_common_day: topDay ? topDay[0] : null,
      };
    }).sort((a, b) => b.yearly_eur - a.yearly_eur);
    return {
      period: p,
      baskets,
      small_purchase_limit_eur: SMALL_PURCHASE_EUR,
      purchases_per_month: r2(rows.length / n),
      monthly_eur: r2(total / n),
      yearly_eur: r2((total / n) * 12),
      share_of_all_spending_pct: (() => {
        const all = txs.filter((t) => t.spend && t.date >= p.start && t.date <= p.end).reduce((a, t) => a + t.spend, 0);
        return all ? Math.round((total / all) * 100) : 0;
      })(),
      habits: list,
    };
  }

  // ---------- spender profile ----------
  function profile() {
    const p = resolvePeriod("last_12_months");
    const n = monthsIn(p);
    const rows = txs.filter((t) => t.date >= p.start && t.date <= p.end);
    const spend = rows.filter((t) => t.spend);
    const every = spend.filter((t) => t.basket === "everyday");
    const avg = averages("last_12_months");
    const sum = (arr) => arr.reduce((a, t) => a + t.spend, 0);
    const monthly = months.filter((m) => `${m}-31` >= p.start).map((m) => MONTH_STATS[m].spend);
    const mean = monthly.reduce((a, v) => a + v, 0) / monthly.length;
    const sd = Math.sqrt(monthly.reduce((a, v) => a + (v - mean) ** 2, 0) / monthly.length);
    const half = (from, to) => sum(spend.filter((t) => t.date >= from && t.date <= to));
    const mid = addDays(p.start, Math.floor(daysBetween(p.start, p.end) / 2));
    const firstHalf = half(p.start, mid), secondHalf = half(addDays(mid, 1), p.end);
    const small = every.filter((t) => t.spend < 15);
    const weekend = every.filter((t) => [0, 6].includes(weekday(t.date)));
    const evening = every.filter((t) => t.time >= "18");
    const byLabel = {};
    for (const t of every) byLabel[label(t)] = (byLabel[label(t)] || 0) + t.spend;
    const lowBalanceDays = new Set(rows.filter((t) => t.balance < 0).map((t) => t.date)).size;
    return {
      period: p,
      monthly_income_eur: avg.income,
      monthly_spending_eur: avg.spend,
      monthly_to_investments_eur: avg.saving,
      savings_rate_pct: avg.income ? Math.round(((avg.income - avg.spend) / avg.income) * 100) : null,
      basket_monthly_eur: Object.fromEntries(SPEND_KEYS.map((k) => [k, avg[k]])),
      basket_share_pct: Object.fromEntries(SPEND_KEYS.map((k) => [k, Math.round((avg[k] / avg.spend) * 100)])),
      could_live_without_monthly_eur: r2(avg.everyday + avg.extras),
      extras: (() => {
        const ex = spend.filter((t) => t.basket === "extras");
        const byL = {};
        for (const t of ex) byL[label(t)] = (byL[label(t)] || 0) + t.spend;
        return {
          purchases_per_month: r2(ex.length / n),
          average_purchase_eur: ex.length ? r2(sum(ex) / ex.length) : 0,
          top: Object.entries(byL).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ label: k, monthly_eur: r2(v / n) })),
        };
      })(),
      everyday: {
        purchases_per_month: Math.round(every.length / n),
        average_purchase_eur: every.length ? r2(sum(every) / every.length) : 0,
        small_purchases_under_15_eur_per_month: Math.round(small.length / n),
        small_purchases_total_per_month_eur: r2(sum(small) / n),
        weekend_share_pct: every.length ? Math.round((sum(weekend) / sum(every)) * 100) : 0,
        evening_share_pct: every.length ? Math.round((sum(evening) / sum(every)) * 100) : 0,
        top: Object.entries(byLabel).sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([k, v]) => ({ label: k, monthly_eur: r2(v / n) })),
      },
      month_to_month_variation_pct: mean ? Math.round((sd / mean) * 100) : 0,
      biggest_month: (() => {
        const ms = months.filter((m) => `${m}-31` >= p.start);
        const m = ms.reduce((a, b) => (MONTH_STATS[b].spend > MONTH_STATS[a].spend ? b : a));
        return { month: m, spending_eur: r2(MONTH_STATS[m].spend) };
      })(),
      spending_trend_pct: firstHalf ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : 0,
      days_with_negative_balance: lowBalanceDays,
      current_balance_eur: txs[txs.length - 1].balance,
      benchmark: benchmarks ? benchmark().summary : null,
    };
  }

  // ---------- safe to spend ----------
  function safeToSpend({ days = 7 } = {}) {
    const balance = txs[txs.length - 1].balance;
    const salaries = txs.filter((t) => t.type === "salary").slice(-6);
    const payDays = salaries.map((t) => Number(t.date.slice(8))).sort((a, b) => a - b);
    const payDay = payDays[Math.floor(payDays.length / 2)] || 15;
    const ym = today.slice(0, 7);
    let nextPay = `${ym}-${String(payDay).padStart(2, "0")}`;
    if (nextPay <= today) {
      const [y, m] = ym.split("-").map(Number);
      nextPay = toDate(Date.UTC(y, m, Math.min(payDay, 28)));
    }
    const daysToPay = daysBetween(today, nextPay) - 1;
    const avg6 = averages("last_6_months");
    const n6 = monthsIn(resolvePeriod("last_6_months"));

    const housing = txs.filter((t) => t.type === "housing_payment");
    const lastHousing = housing[housing.length - 1];
    const housingPaidThisMonth = housing.some((t) => t.date.startsWith(ym));
    const housingDay = lastHousing ? Number(lastHousing.date.slice(8)) : null;
    let housingDue = 0;
    if (lastHousing) {
      const nextHousing = housingPaidThisMonth
        ? toDate(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)), housingDay))
        : `${ym}-${String(housingDay).padStart(2, "0")}`;
      if (nextHousing <= nextPay) housingDue = -lastHousing.amount;
    }
    const housingMonthly = housing.length ? -housing.slice(-6).reduce((a, t) => a + t.amount, 0) / Math.min(6, housing.length) : 0;
    const otherRegularDaily = (avg6.regular - housingMonthly) / 30.4375;
    const irregularDaily = avg6.irregular / 30.4375;
    const savingDaily = avg6.saving / 30.4375;

    const committed = {
      rent_before_next_salary_eur: r2(housingDue),
      other_regular_costs_until_salary_eur: r2(otherRegularDaily * daysToPay),
      irregular_buffer_until_salary_eur: r2(irregularDaily * daysToPay),
      usual_investing_until_salary_eur: r2(savingDaily * daysToPay),
    };
    const committedTotal = Object.values(committed).reduce((a, v) => a + v, 0);
    const cushion = r2(avg6.regular + avg6.irregular); // keep one month of mandatory costs untouched
    const free = balance - committedTotal - cushion;

    // Habit view: what your income supports each week after the two mandatory baskets and saving.
    // That allowance covers the two flexible baskets: everyday + extras.
    const weeklyFlexible = (avg6.income - avg6.regular - avg6.irregular - avg6.saving) * 7 / 30.4375;
    const weekStart = mondayOf(today);
    const flex = (t) => t.basket === "everyday" || t.basket === "extras";
    const spentThisWeek = txs.filter((t) => t.date >= weekStart && flex(t)).reduce((a, t) => a + t.spend, 0);
    const everydayWeeklyHabit = (avg6.everyday * 7) / 30.4375;
    const extrasWeeklyHabit = (avg6.extras * 7) / 30.4375;

    return {
      today,
      days_requested: days,
      current_balance_eur: balance,
      next_salary: { expected_date: nextPay, days_away: daysToPay, typical_amount_eur: r2(salaries.reduce((a, t) => a + t.amount, 0) / salaries.length) },
      budget_view: {
        explanation: "Average monthly income minus regular costs, the irregular buffer and usual investing, turned into a weekly allowance for the two flexible baskets (everyday + extras).",
        weekly_flexible_allowance_eur: r2(weeklyFlexible),
        for_requested_days_eur: r2((weeklyFlexible / 7) * days),
        flexible_spent_this_week_eur: r2(spentThisWeek),
        left_this_week_eur: r2(weeklyFlexible - spentThisWeek),
        your_usual_per_week_eur: { everyday: r2(everydayWeeklyHabit), extras: r2(extrasWeeklyHabit) },
      },
      tight_month_view: {
        explanation: "If money got tight: the mandatory baskets stay, extras pause, everyday habits are trimmed.",
        monthly_mandatory_eur: r2(avg6.regular + avg6.irregular),
        monthly_extras_you_could_pause_eur: avg6.extras,
        months_your_balance_covers_mandatory_costs: avg6.regular + avg6.irregular
          ? r2(balance / (avg6.regular + avg6.irregular)) : null,
      },
      balance_view: {
        explanation: "Balance minus everything committed until the next salary, minus a safety cushion of one month of mandatory costs.",
        committed_until_next_salary: committed,
        safety_cushion_eur: cushion,
        free_after_commitments_eur: r2(free),
        per_day_until_salary_eur: daysToPay ? r2(free / daysToPay) : r2(free),
      },
      based_on: "last 6 months of your transactions",
      housing_day_of_month: housingDay,
      monthly_avg_last_6_months: avg6,
      n_months: r2(n6),
    };
  }

  // ---------- what-if ----------
  function whatIf({ categories: cats, merchant_types: mts, baskets, reduce_pct, reduce_eur_per_month,
    period = "last_12_months", years = 5, annual_return_pct = 0 } = {}) {
    const { p, rows } = select({ period, categories: cats, merchant_types: mts, baskets, flow: "spending" });
    const n = monthsIn(p);
    const monthly = rows.reduce((a, t) => a + t.spend, 0) / n;
    const perMonth = rows.length / n;
    const avgTicket = rows.length ? rows.reduce((a, t) => a + t.spend, 0) / rows.length : 0;
    let saving = reduce_eur_per_month != null ? Math.min(reduce_eur_per_month, monthly) : monthly * (reduce_pct ?? 20) / 100;
    const rM = (annual_return_pct || 0) / 100 / 12;
    const mths = years * 12;
    const fv = rM ? saving * ((1 + rM) ** mths - 1) / rM : saving * mths;
    const avg = averages(period);
    return {
      target: { categories: cats, merchant_types: mts, baskets },
      based_on: p,
      current_monthly_eur: r2(monthly),
      current_purchases_per_month: r2(perMonth),
      average_purchase_eur: r2(avgTicket),
      reduction: reduce_eur_per_month != null ? `${reduce_eur_per_month} EUR/month` : `${reduce_pct ?? 20}%`,
      saving_per_month_eur: r2(saving),
      saving_per_year_eur: r2(saving * 12),
      fewer_purchases_per_month_equivalent: avgTicket ? r2(saving / avgTicket) : 0,
      [`total_after_${years}_years_eur`]: r2(fv),
      annual_return_pct_assumed: annual_return_pct || 0,
      new_savings_rate_pct: avg.income ? Math.round(((avg.income - avg.spend + saving) / avg.income) * 100) : null,
      old_savings_rate_pct: avg.income ? Math.round(((avg.income - avg.spend) / avg.income) * 100) : null,
    };
  }

  // ---------- Statistics Finland benchmark ----------
  function ageGroup(age) {
    const groups = ["17-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75-84"];
    return groups.find((g) => { const [a, b] = g.split("-").map(Number); return age >= a && age <= b; }) || "85-";
  }
  function benchmark({ age_group, period = "last_12_months" } = {}) {
    if (!benchmarks) return { error: "Benchmarks not loaded" };
    const hbs = benchmarks.householdBudgetSurvey;
    const cpi = benchmarks.consumerPriceIndex;
    const group = age_group || ageGroup(data.customer.age);
    const ref = hbs.byAge[group] || hbs.byAge.all;
    const cpiMonth = Object.keys(cpi.monthly).filter((m) => m <= today.slice(0, 7)).sort().pop();
    const factor = cpi.monthly[cpiMonth].index / cpi.average2022;
    const p = resolvePeriod(period);
    const n = monthsIn(p);
    const mine = {};
    for (const t of txs) if (t.spend && t.date >= p.start && t.date <= p.end) mine[t.category] = (mine[t.category] || 0) + t.spend;
    const rows = Object.entries(ref.categories).map(([cat, v]) => {
      const you = (mine[cat] || 0) / n;
      const them = v * factor;
      return { category: cat, you_monthly_eur: r2(you), finland_monthly_eur: r2(them), difference_eur: r2(you - them), ratio: them ? r2(you / them) : null };
    }).sort((a, b) => b.difference_eur - a.difference_eur);
    const youTotal = Object.values(mine).reduce((a, v) => a + v, 0) / n;
    return {
      comparison_group: group === "all" ? "all households in Finland" : `households where the main person is aged ${group}`,
      unit: "EUR per month, per consumption unit (about one adult)",
      price_adjustment: `2022 survey figures raised ${Math.round((factor - 1) * 100)}% to ${cpiMonth} prices using the consumer price index`,
      period: p,
      rows,
      summary: {
        your_total_monthly_eur: r2(youTotal),
        finland_total_comparable_categories_eur: r2(rows.reduce((a, r) => a + r.finland_monthly_eur, 0)),
        finland_all_consumption_eur: r2(ref.total * factor),
        group,
      },
      caveats: [
        "The housing benchmark averages renters and owners; owners pay no rent, so the rent average is low.",
        "The survey counts all consumption (also items not in this bank account), so treat it as a rough reference.",
      ],
      source: `${benchmarks.source}. ${hbs.table}; ${cpi.table}.`,
    };
  }

  return {
    data, txs, today, firstDate, months, categories, merchantTypes, label,
    MONTH_STATS, monthStats, averages, resolvePeriod, query, profile, safeToSpend, whatIf, benchmark, habits, mood,
    describe,
  };
}
