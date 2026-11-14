// Seasonal spending pattern in Finland, from Statistics Finland's monthly
// turnover indexes (original, not seasonally adjusted series):
//   StatFin/klv/14kr  Turnover of trade (retail by type of shop)
//   StatFin/plv/14k7  Turnover of service industries (restaurants, hotels)
// For each year, every month is expressed against that year's average month
// (100 = average), then averaged over the years. Writes src/game/seasonality.ts.
//
// Usage: node scripts/fetch-seasonality.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "game", "seasonality.ts");
const API = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin";
const YEARS = [2023, 2024, 2025];

const SERIES = {
  retail: { label: "Retail, all shops", table: "klv/14kr.px", industry: "G47", content: "klv-alkuperainen" },
  groceries: { label: "Groceries", table: "klv/14kr.px", industry: "G4711", content: "klv-alkuperainen" },
  clothes: { label: "Clothes & other goods", table: "klv/14kr.px", industry: "G477", content: "klv-alkuperainen" },
  hobbies: { label: "Books, toys, sports & hobbies", table: "klv/14kr.px", industry: "G476", content: "klv-alkuperainen" },
  electronics: { label: "Electronics & phones", table: "klv/14kr.px", industry: "G474", content: "klv-alkuperainen" },
  home: { label: "Home equipment", table: "klv/14kr.px", industry: "G475", content: "klv-alkuperainen" },
  restaurants: { label: "Restaurants & cafés", table: "plv/14k7.px", industry: "I56", content: "plv-alkuperainen" },
  hotels: { label: "Hotels & accommodation", table: "plv/14k7.px", industry: "I55", content: "plv-alkuperainen" },
};

const months = YEARS.flatMap((y) => Array.from({ length: 12 }, (_, i) => `${y}M${String(i + 1).padStart(2, "0")}`));

async function fetchSeries({ table, industry, content }) {
  const res = await fetch(`${API}/${table}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: [
        { code: "timeperiod_m", selection: { filter: "item", values: months } },
        { code: "nace_8_20180101", selection: { filter: "item", values: [industry] } },
        { code: "luokkaryhma_2_20180301", selection: { filter: "item", values: ["lv"] } },
        { code: "contentscode", selection: { filter: "item", values: [content] } },
      ],
      response: { format: "json-stat2" },
    }),
  });
  if (!res.ok) throw new Error(`${table} ${industry}: HTTP ${res.status}`);
  const js = await res.json();
  const order = js.dimension.timeperiod_m.category.index;
  const byMonth = Object.fromEntries(months.map((m) => [m, js.value[order[m]]]));
  const profile = Array(12).fill(0);
  for (const y of YEARS) {
    const vals = Array.from({ length: 12 }, (_, i) => byMonth[`${y}M${String(i + 1).padStart(2, "0")}`]);
    const avg = vals.reduce((a, v) => a + v, 0) / 12;
    vals.forEach((v, i) => (profile[i] += ((v / avg) * 100) / YEARS.length));
  }
  return profile.map((v) => Math.round(v));
}

const series = {};
for (const [key, s] of Object.entries(SERIES)) {
  series[key] = { label: s.label, profile: await fetchSeries(s) };
  console.log(key.padEnd(12), series[key].profile.join(" "));
}

// What households actually spend, in euros: quarterly national accounts
// (household consumption expenditure in Finland, original series, current
// prices) divided by the population, per person per month.
async function json(table, query) {
  const res = await fetch(`${API}/${table}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, response: { format: "json-stat2" } }),
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
  return res.json();
}
const quarters = YEARS.flatMap((y) => [1, 2, 3, 4].map((q) => `${y}Q${q}`));
const qna = await json("ntp/132h.px", [
  { code: "timeperiod_q", selection: { filter: "item", values: quarters } },
  { code: "taloustoimi_1_20180101", selection: { filter: "item", values: ["P31KDC"] } },
  { code: "contentscode", selection: { filter: "item", values: ["tasmcp"] } },
]);
const qOrder = qna.dimension.timeperiod_q.category.index;
const popYears = [YEARS[0] - 1, ...YEARS].map(String);
const pop = await json("vaerak/11ra.px", [
  { code: "alue_23_20260101", selection: { filter: "item", values: ["SSS"] } },
  { code: "contentscode", selection: { filter: "item", values: ["vaerak-vaesto"] } },
  { code: "timeperiod_y", selection: { filter: "item", values: popYears } },
]);
const popOrder = pop.dimension.timeperiod_y.category.index;
const byYear = {};
for (const y of YEARS) {
  // average of the population at the start and end of the year
  const people = (pop.value[popOrder[String(y - 1)]] + pop.value[popOrder[String(y)]]) / 2;
  byYear[y] = [1, 2, 3, 4].map((q) => Math.round((qna.value[qOrder[`${y}Q${q}`]] * 1e6) / people / 3));
  console.log(`household €/person/month ${y}:`, byYear[y].join(" "));
}
const perPersonMonthByQuarter = [0, 1, 2, 3].map((i) => Math.round(YEARS.reduce((a, y) => a + byYear[y][i], 0) / YEARS.length));

const payload = {
  source: "Statistics Finland (Tilastokeskus), turnover of trade (14kr) and of service industries (14k7), original index series, CC BY 4.0",
  years: YEARS,
  note: "Each month against the year's average month (100). Business turnover, so it includes price changes, tourists and some business buying.",
  fetched: new Date().toISOString().slice(0, 10),
  series,
  household: {
    label: "Household spending per person per month",
    source: "Statistics Finland (Tilastokeskus), quarterly national accounts (132h, household consumption expenditure in Finland, original series, current prices) and population (11ra), CC BY 4.0",
    note: "Per person including children; includes the calculated rent value of owner-occupied homes. Quarterly: official monthly euro figures don't exist.",
    quarters: ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"],
    perPersonMonthByQuarter,
    byYear,
  },
};

writeFileSync(
  OUT,
  `// Generated by scripts/fetch-seasonality.mjs - do not edit by hand.\n` +
    `// Finland's seasonal spending pattern: 100 = an average month (index per calendar month, Jan..Dec).\n\n` +
    `export const SEASONALITY = ${JSON.stringify(payload, null, 2)} as const;\n\n` +
    `export type SeasonSeries = keyof typeof SEASONALITY.series;\n`,
);
console.log(`Wrote ${OUT}`);
