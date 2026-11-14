// Gemini answers as Mikko. Numbers and charts come from the game engine
// and Statistics Finland benchmarks stored in Postgres. The model never
// invents a figure: it calls a tool, then speak().

import { GoogleGenAI } from "@google/genai";
import {
  computeBaskets,
  computeSafeToSpend,
  filterTransactions,
  getLatestMonthKey,
  resolveTxBasket,
  simulateWhatIf,
} from "../src/game/engine.ts";
import type { ChartPayload, LabelOverride, MentorMood, Transaction, WhatIfAsset } from "../src/game/types.ts";

const MODEL = process.env.GEMINI_MODEL || "gemini-4-hydrogen";
const THINKING = process.env.GEMINI_THINKING_LEVEL || "medium";

const MOODS = new Set<MentorMood>([
  "deadpan", "suspicious", "pointing", "bluff_caught", "impressed", "level_up",
]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TOOLS = [
  {
    type: "function" as const,
    name: "month_baskets",
    description: "Totals for the latest month: income, mandatory regular, mandatory irregular, slips, and total spend. Call this for a general 'where did my money go' question.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function" as const,
    name: "spend_series",
    description: "Monthly spend for one focus, plus the latest month's total, count, and average. Use for taxis, restaurants, groceries, transport, housing, utilities, health, entertainment, lifestyle, travel, home tech, or slips.",
    parameters: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          enum: ["taxi", "restaurants", "groceries", "transport", "housing", "utilities", "health", "entertainment", "lifestyle", "travel", "home_tech", "slips"],
        },
      },
      required: ["focus"],
    },
  },
  {
    type: "function" as const,
    name: "safe_to_spend",
    description: "What is safe to spend this week after reserving upcoming regular bills and a surprise buffer. Uses the latest balance.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function" as const,
    name: "compare_to_finland",
    description: "Compare the latest month with Statistics Finland household budget figures for the customer's age, price-adjusted with the consumer price index.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function" as const,
    name: "what_if",
    description: "Simulate redirecting a monthly amount into cash, an S-savings account (2.75%), a global index fund, or a volatile Nokia replay. Use dining_cut for 20% of latest restaurant spend, taxi for the latest month of taxis, or custom with monthly_amount.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["custom", "dining_cut", "taxi"] },
        monthly_amount: { type: "number", description: "Euros per month. Required when source is custom." },
        months: { type: "number", description: "Horizon in months. Default 36." },
        asset: { type: "string", enum: ["index_fund", "nokia", "savings"] },
      },
      required: ["source"],
    },
  },
  {
    type: "function" as const,
    name: "speak",
    description: "Say the final line to the user. Call this exactly once, after a data tool. Quote only numbers the tools returned. One to three short sentences.",
    parameters: {
      type: "object",
      properties: {
        mood: { type: "string", enum: ["deadpan", "suspicious", "pointing", "impressed"] },
        text: { type: "string" },
      },
      required: ["mood", "text"],
    },
  },
];

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function monthLabel(key: string) {
  const month = Number(key.slice(5, 7));
  return MONTHS[month - 1] ?? key;
}

function recentMonths(transactions: Transaction[], count = 6) {
  const keys = [...new Set(transactions.map((t) => t.date.slice(0, 7)))].sort();
  return keys.slice(-count);
}

function matchesFocus(tx: Transaction, focus: string, overrides: LabelOverride[]) {
  if (tx.amount >= 0) return false;
  switch (focus) {
    case "taxi": return tx.mcc === "4121";
    case "restaurants": return tx.category === "Restaurants";
    case "groceries": return tx.category === "Groceries";
    case "transport": return tx.category === "Transportation";
    case "housing": return tx.category === "Housing";
    case "utilities": return tx.category === "Utilities";
    case "health": return tx.category === "Health";
    case "entertainment": return tx.category === "Entertainment";
    case "lifestyle": return tx.category === "Lifestyle";
    case "travel": return tx.category === "Travel";
    case "home_tech": return tx.category === "Home & Tech";
    case "slips": return resolveTxBasket(tx, overrides).basket === "slips";
    default: return false;
  }
}

function ageGroup(age: number) {
  const groups = ["17-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75-84"];
  return groups.find((group) => {
    const [from, to] = group.split("-").map(Number);
    return age >= from && age <= to;
  }) || "85-";
}

function priceFactor(benchmarks: any, today: string) {
  const cpi = benchmarks?.consumerPriceIndex;
  if (!cpi?.monthly || !cpi.average2022) return { factor: 1, month: null as string | null };
  const month = Object.keys(cpi.monthly).filter((key) => key <= today.slice(0, 7)).sort().pop() ?? null;
  if (!month) return { factor: 1, month };
  return { factor: cpi.monthly[month].index / cpi.average2022, month };
}

function argsOf(call: { arguments?: unknown }) {
  const raw = call.arguments;
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw as Record<string, unknown>;
}

function sanitizeOverrides(raw: unknown): LabelOverride[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is LabelOverride => {
    if (!item || typeof item !== "object") return false;
    const basket = (item as LabelOverride).basket;
    const label = (item as LabelOverride).customLabel;
    return typeof label === "string" && (basket === "mandatory_regular" || basket === "mandatory_irregular" || basket === "slips");
  }).slice(0, 80);
}

export async function answerWithGemini(params: {
  query: string;
  customer: { id: string; age: number; postalCode: string };
  transactions: Transaction[];
  overrides: unknown;
  history: { role?: string; text?: string }[];
  benchmarks: any;
}) {
  const query = String(params.query || "").trim().slice(0, 2000);
  if (!query) return { text: "Ask me something about the money.", mood: "deadpan" as MentorMood };

  const overrides = sanitizeOverrides(params.overrides);
  const visible = filterTransactions(params.transactions, false);
  const latestMonth = getLatestMonthKey(visible);
  const today = visible.map((t) => t.date).sort().pop() ?? latestMonth;
  let chart: ChartPayload | undefined;

  const run = (name: string, args: Record<string, unknown>) => {
    if (name === "month_baskets") {
      const baskets = computeBaskets(visible, overrides, latestMonth);
      return {
        month: latestMonth,
        income: baskets.income,
        mandatory_regular: baskets.mandatory_regular,
        mandatory_irregular: baskets.mandatory_irregular,
        slips: baskets.slips,
        total_spend: baskets.totalSpend,
      };
    }

    if (name === "spend_series") {
      const focus = String(args.focus || "slips");
      const months = recentMonths(visible);
      const bars = months.map((month) => {
        const rows = visible.filter((t) => t.date.startsWith(month) && matchesFocus(t, focus, overrides));
        return {
          label: monthLabel(month),
          value: round2(rows.reduce((sum, t) => sum + Math.abs(t.amount), 0)),
          highlight: month === latestMonth,
          count: rows.length,
        };
      });
      const latest = bars.find((bar) => bar.highlight) ?? bars[bars.length - 1];
      chart = {
        kind: "bar",
        title: `${focus.replaceAll("_", " ")} spend`,
        subtitle: `${latestMonth} · €${(latest?.value ?? 0).toFixed(2)} across ${latest?.count ?? 0}`,
        bars: bars.map(({ label, value, highlight }) => ({ label, value, highlight })),
      };
      return { focus, month: latestMonth, latest_total: latest?.value ?? 0, latest_count: latest?.count ?? 0, months: bars };
    }

    if (name === "safe_to_spend") {
      const safe = computeSafeToSpend(visible, overrides, false);
      chart = { kind: "safe_to_spend", title: "Safe to spend this week", ...safe };
      return { month: latestMonth, ...safe };
    }

    if (name === "compare_to_finland") {
      const group = ageGroup(params.customer.age);
      const table = params.benchmarks?.householdBudgetSurvey?.byAge?.[group]
        ?? params.benchmarks?.householdBudgetSurvey?.byAge?.all;
      const { factor, month: cpiMonth } = priceFactor(params.benchmarks, today);
      const categories = table?.categories ?? {};
      const yours = (category: string) => round2(visible
        .filter((t) => t.date.startsWith(latestMonth) && t.category === category && t.amount < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0));
      const finland = (category: string) => round2(Number(categories[category] || 0) * factor);
      const baskets = computeBaskets(visible, overrides, latestMonth);
      const slipsAvg = round2(finland("Restaurants") + finland("Entertainment") + finland("Lifestyle"));
      const rows = [
        { category: "Restaurants", yours: yours("Restaurants"), finlandAvg: finland("Restaurants") },
        { category: "Transport", yours: yours("Transportation"), finlandAvg: finland("Transportation") },
        { category: "Groceries", yours: yours("Groceries"), finlandAvg: finland("Groceries") },
        { category: "All Slips", yours: baskets.slips, finlandAvg: slipsAvg },
      ];
      chart = {
        kind: "peer_compare",
        title: `You vs Statistics Finland (${group})`,
        subtitle: `${latestMonth}, survey euros lifted to ${cpiMonth ?? "today"} prices`,
        rows,
      };
      return {
        age_group: group,
        postal_code: params.customer.postalCode,
        price_adjusted_to: cpiMonth,
        source: "Statistics Finland, Household Budget Survey 2022, CC BY 4.0",
        note: "Finland figures are per consumption unit per month (about one adult). All Slips compares your slips basket with restaurants + entertainment + lifestyle.",
        rows,
      };
    }

    if (name === "what_if") {
      const source = String(args.source || "custom");
      const asset: WhatIfAsset = args.asset === "nokia" || args.asset === "savings" ? args.asset : "index_fund";
      let monthly = Number(args.monthly_amount);
      let label = "Monthly redirect";
      if (source === "dining_cut" || !Number.isFinite(monthly) || monthly <= 0) {
        const dining = visible
          .filter((t) => t.date.startsWith(latestMonth) && t.category === "Restaurants" && t.amount < 0)
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);
        if (source === "taxi") {
          monthly = visible
            .filter((t) => t.date.startsWith(latestMonth) && t.mcc === "4121" && t.amount < 0)
            .reduce((sum, t) => sum + Math.abs(t.amount), 0);
          label = "Taxi spend redirected";
        } else if (source === "dining_cut" || source !== "custom") {
          monthly = dining * 0.2;
          label = "20% dining cut";
        }
      }
      monthly = round2(Math.max(1, monthly || 0));
      const months = Math.max(1, Math.min(120, Math.round(Number(args.months) || 36)));
      const result = simulateWhatIf({ monthlyAmount: monthly, months, asset, title: label });
      chart = { kind: "what_if", result, sourceLabel: `${label} (€${monthly.toFixed(2)}/mo · ${months} mo)` };
      return {
        source: label,
        monthly_amount: monthly,
        months,
        asset: result.assetLabel,
        final_asset_value: result.finalAssetValue,
        cash_if_uninvested: result.totalCash,
        savings_account_value: result.finalSavingsValue,
        delta_vs_cash: result.deltaVsCash,
      };
    }

    return { error: `Unknown tool ${name}` };
  };

  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prior = (Array.isArray(params.history) ? params.history : [])
    .filter((turn) => turn && typeof turn.text === "string" && turn.text.trim())
    .slice(-8)
    .map((turn) => ({
      type: turn.role === "mentor" ? "model_output" : "user_input",
      content: [{ type: "text", text: String(turn.text).slice(0, 2000) }],
    }));

  const input: any[] = [
    ...prior,
    { type: "user_input", content: [{ type: "text", text: query }] },
  ];

  const system = `You are Mikko, the pixel-art money mentor inside S-mobiili. Deadpan, short, curious, never preachy.
The account owner is ${params.customer.age}, postal code ${params.customer.postalCode}, Finland. Latest data month is ${latestMonth}. Today in the ledger is ${today}.
Baskets: mandatory regular (rent, bills, groceries, commuting), mandatory irregular (health, home and tech), slips (small habits and nice-to-haves that leak out).
Rules:
- Never invent or estimate a number. Call a tool first, then call speak exactly once.
- Quote at most three figures from the tool result. Use euros like €38 or €38.50.
- If a chart tool ran (spend_series, safe_to_spend, compare_to_finland, what_if), set mood to pointing.
- Reply in the language the user writes in.
- You run a simulator, you are not a licensed advisor. Describe the what-if result; do not tell them to buy a product.
- Name Statistics Finland when you use compare_to_finland.`;

  for (let round = 0; round < 5; round++) {
    const interaction = await client.interactions.create({
      model: MODEL,
      input,
      system_instruction: system,
      tools: TOOLS,
      generation_config: { thinking_level: THINKING },
      store: false,
    });
    const steps = interaction.steps ?? [];
    const calls = steps.filter((step) => step.type === "function_call");
    if (!calls.length) {
      const text = (interaction.output_text || "").trim();
      return {
        text: text || "I lost the thread. Ask that once more.",
        mood: (chart ? "pointing" : "deadpan") as MentorMood,
        chart,
      };
    }

    const speak = calls.find((call) => call.name === "speak");
    const dataCalls = calls.filter((call) => call.name !== "speak");
    const results = new Map<string, unknown>();
    for (const call of dataCalls) {
      try {
        results.set(call.id, run(call.name, argsOf(call)));
      } catch (error) {
        results.set(call.id, { error: error instanceof Error ? error.message : "Tool failed" });
      }
    }

    if (speak) {
      const spoken = argsOf(speak);
      const mood = MOODS.has(spoken.mood as MentorMood) ? spoken.mood as MentorMood : (chart ? "pointing" : "deadpan");
      const text = String(spoken.text || "").trim();
      return {
        text: text || "The numbers are on the chart.",
        mood: chart ? "pointing" : mood,
        chart,
      };
    }

    input.push(...steps);
    for (const call of dataCalls) {
      input.push({
        type: "function_result",
        name: call.name,
        call_id: call.id,
        result: [{ type: "text", text: JSON.stringify(results.get(call.id) ?? {}) }],
      });
    }
  }

  return {
    text: "That took too many lookups. Ask it as one question.",
    mood: "deadpan" as MentorMood,
    chart,
  };
}
