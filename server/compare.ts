// "You vs Finland" board: the customer's average month (last 12 months) per
// category against Statistics Finland's Household Budget Survey 2022 for the
// same age group, lifted to today's prices with the consumer price index.

import { filterTransactions, isNonSpending } from "../src/game/engine.ts";
import type { ChartPayload, Transaction } from "../src/game/types.ts";

type Board = Extract<ChartPayload, { kind: "finland_board" }>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function ageGroup(age: number) {
  const groups = ["17-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75-84"];
  return groups.find((group) => {
    const [from, to] = group.split("-").map(Number);
    return age >= from && age <= to;
  }) || "85-";
}

export function priceFactor(benchmarks: any, today: string) {
  const cpi = benchmarks?.consumerPriceIndex;
  if (!cpi?.monthly || !cpi.average2022) return { factor: 1, month: null as string | null };
  const month = Object.keys(cpi.monthly).filter((key) => key <= today.slice(0, 7)).sort().pop() ?? null;
  if (!month) return { factor: 1, month };
  return { factor: cpi.monthly[month].index / cpi.average2022, month };
}

export function buildFinlandBoard(params: {
  customer: { age: number };
  transactions: Transaction[];
  benchmarks: any;
}): Board | null {
  const visible = filterTransactions(params.transactions, false);
  const group = ageGroup(params.customer.age);
  const table = params.benchmarks?.householdBudgetSurvey?.byAge?.[group]
    ?? params.benchmarks?.householdBudgetSurvey?.byAge?.all;
  if (!table?.categories) return null;

  const months = [...new Set(visible.map((t) => t.date.slice(0, 7)))].sort().slice(-12);
  const today = visible.map((t) => t.date).sort().pop() ?? "";
  const { factor, month: cpiMonth } = priceFactor(params.benchmarks, today);
  const inWindow = visible.filter((t) => months.includes(t.date.slice(0, 7)) && t.amount < 0 && !isNonSpending(t));
  const n = Math.max(1, months.length);

  const rows = Object.entries(table.categories as Record<string, number>).map(([category, value]) => {
    const yours = round2(inWindow.filter((t) => t.category === category).reduce((s, t) => s + Math.abs(t.amount), 0) / n);
    const finland = round2(Number(value) * factor);
    const verdict: "more" | "less" | "similar" =
      yours > finland * 1.1 ? "more" : yours < finland * 0.9 ? "less" : "similar";
    return { category, yours, finland, verdict };
  }).sort((a, b) => b.yours - a.yours);

  const yoursTotal = round2(rows.reduce((s, r) => s + r.yours, 0));
  const finlandTotal = round2(rows.reduce((s, r) => s + r.finland, 0));
  const pct = Math.round((factor - 1) * 100);
  return {
    kind: "finland_board",
    title: `You vs Finland · age ${group}`,
    ageGroup: group,
    period: months.length ? `${months[0]} – ${months[months.length - 1]}, per month` : "per month",
    priceNote: cpiMonth ? `2022 survey figures +${pct}% to ${cpiMonth} prices` : "2022 survey figures",
    rows,
    yoursTotal,
    finlandTotal,
    lessCount: rows.filter((r) => r.verdict === "less").length,
    source: "Statistics Finland, Household Budget Survey 2022 & consumer price index (CC BY 4.0)",
    caveat: "Per adult. The survey's rent average includes owners, who pay no rent, so it runs low.",
  };
}
