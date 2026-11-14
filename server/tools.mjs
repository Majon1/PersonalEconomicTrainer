// Tool (function) declarations for Gemini and their implementations.
// Every number the assistant mentions must come from one of these tools.

const PERIOD = {
  type: "string",
  description:
    "Time window. One of: this_week, last_week, this_month, last_month, last_7_days, last_30_days, last_90_days, " +
    "last_3_months, last_6_months, last_12_months, year_to_date, all, a month like '2025-06', or a year like '2025'. " +
    "Ignored if start/end are given.",
};
const FILTERS = {
  period: PERIOD,
  start: { type: "string", description: "Start date YYYY-MM-DD (inclusive). Optional." },
  end: { type: "string", description: "End date YYYY-MM-DD (inclusive). Optional." },
  categories: { type: "array", items: { type: "string" }, description: "Filter by category, e.g. ['Restaurants']." },
  merchant_types: { type: "array", items: { type: "string" }, description: "Filter by merchant type, e.g. ['Taxi', 'Café / fast food']." },
  baskets: { type: "array", items: { type: "string", enum: ["regular", "irregular", "everyday", "extras"] }, description: "Filter by spending basket." },
  flow: { type: "string", enum: ["spending", "income", "saving", "all"], description: "Which money flow. Default spending." },
  weekdays: { type: "array", items: { type: "string" }, description: "Only these weekdays, e.g. ['Saturday','Sunday']." },
  min_amount: { type: "number", description: "Only transactions of at least this many euros." },
  max_amount: { type: "number", description: "Only transactions of at most this many euros." },
  search: { type: "string", description: "Free-text match on category, merchant type or description." },
};
const GROUP_BY = {
  type: "string",
  enum: ["month", "week", "day", "weekday", "hour", "category", "label", "merchant_type", "merchant", "basket"],
  description: "Break the total down by this dimension. 'label' = category, split out where a merchant type sits in a different basket.",
};

export const declarations = [
  {
    name: "query_transactions",
    description:
      "Sum, count and break down the user's transactions with any filters. Use for every factual question about " +
      "amounts (e.g. 'how much did I spend on taxis last month', 'what did I spend most on in May', 'when do I eat out').",
    parameters: {
      type: "object",
      properties: {
        ...FILTERS,
        group_by: GROUP_BY,
        list_transactions: { type: "integer", description: "How many individual transactions to include (0-50). Default 5." },
        sort: { type: "string", enum: ["largest", "recent"], description: "Order of listed transactions. Default largest." },
      },
    },
  },
  {
    name: "get_spender_profile",
    description:
      "Behavioural profile of the last 12 months: basket shares, everyday habits (frequency, average purchase, small " +
      "purchases, weekend and evening shares), month-to-month variation, trend, savings rate and a Statistics Finland " +
      "comparison. Use for 'what kind of spender am I' and similar.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "safe_to_spend",
    description:
      "How much the user can safely spend over the next N days. Returns a budget view (weekly allowance from income " +
      "after regular costs, irregular buffer and usual investing) and a balance view (balance minus commitments until " +
      "the next salary and a one-month safety cushion).",
    parameters: {
      type: "object",
      properties: { days: { type: "integer", description: "Number of days, e.g. 7 for 'this week'. Default 7." } },
    },
  },
  {
    name: "what_if",
    description:
      "Scenario: how much the user would save by cutting spending on some categories, merchant types or baskets by a " +
      "percentage or a fixed amount per month. Optionally projects the savings with an annual return.",
    parameters: {
      type: "object",
      properties: {
        categories: FILTERS.categories,
        merchant_types: FILTERS.merchant_types,
        baskets: FILTERS.baskets,
        reduce_pct: { type: "number", description: "Cut by this percentage, e.g. 20." },
        reduce_eur_per_month: { type: "number", description: "Or cut by this many euros per month." },
        period: { ...PERIOD, description: "Period used as the baseline. Default last_12_months." },
        years: { type: "integer", description: "Projection length in years. Default 5." },
        annual_return_pct: { type: "number", description: "Annual return if the savings are invested. Default 0." },
      },
    },
  },
  {
    name: "find_money_leaks",
    description:
      "Where the money really goes: small, frequent habits in the 'slips through your fingers' basket (purchases up to " +
      "40 EUR such as coffees, quick lunches, snacks, taxis, parking), grouped by merchant type with times per month, " +
      "typical purchase, yearly cost, trend and most common weekday. Use for 'what do I spend on without noticing', " +
      "'where does my money slip away', 'my coffee habit'. Set baskets=['extras'] to analyse nice-to-haves instead.",
    parameters: {
      type: "object",
      properties: {
        period: { ...PERIOD, description: "Default last_12_months." },
        baskets: { type: "array", items: { type: "string", enum: ["everyday", "extras"] }, description: "Default ['everyday']." },
      },
    },
  },
  {
    name: "get_emergency_fund",
    description:
      "The user's emergency fund: money on the account versus the goal of 3 months of money going out (also shows " +
      "the 3-months-of-pay alternative), months covered, progress, how much is missing, and money invested (not counted, " +
      "since it isn't instant cash). Use for questions about savings buffers, emergencies, rainy-day money, safety nets.",
    parameters: {
      type: "object",
      properties: { month: { type: "string", description: "YYYY-MM. Default: the month shown on the dashboard." } },
    },
  },
  {
    name: "get_mood",
    description:
      "The money buddy's mood for a month (happy, mild or angry), its 0-100 score and the reasons: purchases the user " +
      "couldn't afford (with balance left and rent/bills still due), overspending, jumps in everyday spending, and what " +
      "went well. Use when the user asks about the buddy/avatar, its mood, or how they did in a month.",
    parameters: {
      type: "object",
      properties: { month: { type: "string", description: "YYYY-MM. Default: the month shown on the dashboard." } },
    },
  },
  {
    name: "compare_to_finland",
    description:
      "Compare the user's monthly spending per category with Statistics Finland's Household Budget Survey for people " +
      "of the same age (or another age group), adjusted to today's prices with the consumer price index.",
    parameters: {
      type: "object",
      properties: {
        age_group: { type: "string", enum: ["all", "17-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75-84", "85-"], description: "Default: the user's own age group." },
        period: { ...PERIOD, description: "User's period to average. Default last_12_months." },
      },
    },
  },
  {
    name: "show_chart",
    description:
      "Show the user a chart or table in the chat. The data is computed from their transactions with the same filters as " +
      "query_transactions (group_by is required), or set source='finland' to chart the Statistics Finland comparison, or " +
      "source='baskets' to chart monthly spending per basket. Use whenever a picture helps; keep the title short.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short chart title." },
        kind: { type: "string", enum: ["bar", "line", "table"], description: "bar for categories or months, line for trends over time, table for lists." },
        source: { type: "string", enum: ["transactions", "finland", "baskets"], description: "Default transactions." },
        ...FILTERS,
        group_by: GROUP_BY,
        limit: { type: "integer", description: "Max number of groups. Default 12." },
      },
      required: ["title", "kind"],
    },
  },
  {
    name: "update_dashboard",
    description:
      "Change what the dashboard next to the chat shows, so the user can explore further: select a month and/or filter " +
      "the transaction list by basket, and scroll to a section.",
    parameters: {
      type: "object",
      properties: {
        month: { type: "string", description: "Month to show, YYYY-MM." },
        basket_filter: { type: "string", enum: ["all", "regular", "irregular", "everyday", "extras", "money"] },
        section: { type: "string", enum: ["status", "buddy", "emergency", "baskets", "habits", "monthly", "categories", "finland", "transactions", "mydata"] },
      },
    },
  },
];

/** Run one tool call. Returns { result, block?, action? }. */
export function runTool(engine, name, args = {}) {
  switch (name) {
    case "query_transactions":
      return { result: engine.query(args) };
    case "get_spender_profile":
      return { result: engine.profile() };
    case "safe_to_spend":
      return { result: engine.safeToSpend(args) };
    case "what_if":
      return { result: engine.whatIf(args) };
    case "get_emergency_fund":
      return { result: engine.emergencyFund(args.month || engine.viewMonth || undefined) };
    case "get_mood":
      return { result: engine.mood(args.month || engine.viewMonth || undefined) };
    case "find_money_leaks":
      return { result: engine.habits(args) };
    case "compare_to_finland":
      return { result: engine.benchmark(args) };
    case "show_chart":
      return showChart(engine, args);
    case "update_dashboard":
      return { result: { ok: true, shown: args }, action: { type: "dashboard", ...args } };
    default:
      return { result: { error: `Unknown tool ${name}` } };
  }
}

function showChart(engine, args) {
  const { title, kind = "bar", source = "transactions", limit = 12 } = args;
  let block;
  if (source === "finland") {
    const b = engine.benchmark(args);
    block = {
      type: "chart", kind: kind === "line" ? "bar" : kind, title, unit: "€ / month",
      series: [{ name: "You", key: "you" }, { name: `Finland, age ${b.summary.group}`, key: "fi" }],
      rows: b.rows.map((r) => ({ label: r.category, you: r.you_monthly_eur, fi: r.finland_monthly_eur })),
      note: `${b.price_adjustment}. Source: Statistics Finland.`,
    };
  } else if (source === "baskets") {
    const p = engine.resolvePeriod(args.period || "last_12_months", args.start, args.end);
    const months = engine.months.filter((m) => m >= p.start.slice(0, 7) && m <= p.end.slice(0, 7));
    block = {
      type: "chart", kind: kind === "table" ? "table" : "stacked", title, unit: "€",
      series: [{ name: "Regular", key: "regular" }, { name: "Irregular", key: "irregular" }, { name: "Everyday", key: "everyday" }, { name: "Extras", key: "extras" }],
      rows: months.map((m) => {
        const s = engine.MONTH_STATS[m];
        return { label: m, regular: Math.round(s.regular), irregular: Math.round(s.irregular), everyday: Math.round(s.everyday), extras: Math.round(s.extras) };
      }),
    };
  } else {
    const q = engine.query({ ...args, group_by: args.group_by || "month", list_transactions: 0, limit });
    block = {
      type: "chart", kind, title, unit: "€",
      series: [{ name: q.flow === "income" ? "Income" : "Spent", key: "v" }, { name: "Transactions", key: "n", table: true }],
      rows: (q.groups || []).map((g) => ({ label: g.key, v: g.total_eur, n: g.transactions })),
      note: `${q.period.label} · total ${q.total_eur} € in ${q.transactions} transactions`,
    };
  }
  return { result: { shown: true, rows: block.rows.length, data: block.rows.slice(0, 24) }, block };
}
