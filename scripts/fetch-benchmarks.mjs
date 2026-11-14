// Download open benchmark data from Statistics Finland (PxWeb API, CC BY 4.0)
// and store the result in the benchmarks table.
//
//  - Household budget survey, table 14q4: consumption expenditure per
//    consumption unit per month, by age of the household reference person.
//  - Consumer price index (2025=100), table 15b5: monthly overall index,
//    used to lift survey euros to today's price level.
//
// The server calls refreshBenchmarksIfStale on start and hourly. That checks
// the published months at most once a day, and downloads only when a newer
// price-index month (or a newer survey year) is out.
//
// Usage:  node scripts/fetch-benchmarks.mjs

import { pathToFileURL } from "node:url";
import { createPool, saveBenchmarks } from "../server/db.mjs";

const API = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin";

// Our transaction categories -> COICOP 2018 codes used in the survey.
export const CATEGORY_COICOP = {
  "Groceries": ["01"],
  "Restaurants": ["111"],
  "Housing": ["041"],
  "Utilities": ["044", "045"],
  "Transportation": ["072", "0731", "0732", "0735", "0736"],
  "Health": ["06"],
  "Home & Tech": ["05", "081"],
  "Entertainment": ["094", "096"],
  "Lifestyle": ["03", "091", "092", "097"],
  "Travel": ["0733", "098", "112"],
};

/** True when the published period (YYYY-MM or YYYY) is later than the stored one. */
export function isNewerPeriod(published, stored) {
  if (!published) return false;
  if (!stored) return true;
  return published > stored;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** "2026M10" -> "2026-10" */
function monthKey(statMonth) {
  return `${statMonth.slice(0, 4)}-${statMonth.slice(5)}`;
}

async function query(table, selections) {
  const res = await fetch(`${API}/${table}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: Object.entries(selections).map(([code, values]) => ({
        code, selection: { filter: "item", values },
      })),
      response: { format: "json-stat2" },
    }),
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function metadata(table) {
  const res = await fetch(`${API}/${table}`);
  if (!res.ok) throw new Error(`${table} metadata: HTTP ${res.status}`);
  return res.json();
}

function valuesOf(meta, code) {
  const variable = meta.variables?.find((v) => v.code === code);
  if (!variable) throw new Error(`No ${code} in ${meta.title ?? "table"}`);
  return variable.values;
}

// Turn a json-stat2 cube into a lookup function get({dim: value, ...}).
function cube(js) {
  const ids = js.id;
  const sizes = js.size;
  const index = ids.map((id) => js.dimension[id].category.index);
  return (coords) => {
    let pos = 0;
    ids.forEach((id, i) => { pos = pos * sizes[i] + index[i][coords[id]]; });
    return js.value[pos];
  };
}

export async function latestPublishedCpiMonth() {
  const months = valuesOf(await metadata("khi/15b5.px"), "timeperiod_m")
    .filter((m) => m >= "2022M01")
    .sort();
  return monthKey(months.at(-1));
}

export function storedCpiMonth(benchmarks) {
  const keys = Object.keys(benchmarks?.consumerPriceIndex?.monthly ?? {}).sort();
  return keys.at(-1) ?? null;
}

export async function latestPublishedSurveyYear() {
  const years = valuesOf(await metadata("ktutk/14q4.px"), "timeperiod_y").map(Number).filter(Number.isFinite);
  return Math.max(...years);
}

export async function fetchSurvey(year) {
  const codes = [...new Set(["0", ...Object.values(CATEGORY_COICOP).flat()])];
  const ages = ["SSS", "17-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75-84", "85-"];
  const y = String(year);
  const hbs = await query("ktutk/14q4.px", {
    timeperiod_y: [y],
    coicop_46_20231201: codes,
    ikaryhma_10_20180101: ages,
    contentscode: ["kulukk_kt_hk_2_1"],
  });
  const get = cube(hbs);
  const byAge = {};
  for (const age of ages) {
    const cats = {};
    for (const [cat, cs] of Object.entries(CATEGORY_COICOP)) {
      cats[cat] = Math.round(cs.reduce((a, c) => a + (get({
        timeperiod_y: y, coicop_46_20231201: c, ikaryhma_10_20180101: age, contentscode: "kulukk_kt_hk_2_1",
      }) ?? 0), 0));
    }
    byAge[age === "SSS" ? "all" : age] = {
      total: Math.round(get({ timeperiod_y: y, coicop_46_20231201: "0", ikaryhma_10_20180101: age, contentscode: "kulukk_kt_hk_2_1" })),
      categories: cats,
    };
  }
  return {
    table: "StatFin/ktutk/14q4 - Household consumption expenditure by age of reference person",
    url: "https://pxdata.stat.fi/PxWeb/pxweb/en/StatFin/StatFin__ktutk/statfin_ktutk_pxt_14q4.px/",
    year,
    unit: `EUR per consumption unit per month, current (${year}) prices`,
    note: "A consumption unit is roughly one adult (OECD modified scale), so these approximate the spending of a single adult.",
    categoryCoicop: CATEGORY_COICOP,
    byAge,
  };
}

export async function fetchCpi() {
  const meta = await metadata("khi/15b5.px");
  const months = valuesOf(meta, "timeperiod_m").filter((m) => m >= "2022M01").sort();
  const cpi = await query("khi/15b5.px", {
    timeperiod_m: months, coicop_46_20231201: ["SSS"], contentscode: ["ip_khi", "vm_khi"],
  });
  const getCpi = cube(cpi);
  const cpiMonthly = Object.fromEntries(months.map((m) => [
    monthKey(m),
    {
      index: getCpi({ timeperiod_m: m, coicop_46_20231201: "SSS", contentscode: "ip_khi" }),
      annualChangePct: getCpi({ timeperiod_m: m, coicop_46_20231201: "SSS", contentscode: "vm_khi" }),
    },
  ]));
  const year2022 = months.filter((m) => m.startsWith("2022"));
  const avg2022 = year2022.reduce((a, m) => a + cpiMonthly[monthKey(m)].index, 0) / year2022.length;
  return {
    table: "StatFin/khi/15b5 - Consumer Price Index (2025=100), monthly",
    url: "https://pxdata.stat.fi/PxWeb/pxweb/en/StatFin/StatFin__khi/statfin_khi_pxt_15b5.px/",
    average2022: Math.round(avg2022 * 100) / 100,
    monthly: cpiMonthly,
  };
}

let refreshing = null;

/**
 * Look at Statistics Finland at most once a day. Download the price index only
 * when a newer month is published, and the household survey only when a newer
 * year is published. Returns the payload to use (unchanged if nothing new, or
 * if Statistics Finland can't be reached).
 */
export function refreshBenchmarksIfStale(pool, current) {
  if (current?.checked === today()) return Promise.resolve(current);
  if (refreshing) return refreshing;
  refreshing = updateIfPublished(pool, current).finally(() => { refreshing = null; });
  return refreshing;
}

async function updateIfPublished(pool, current) {
  try {
    const publishedCpi = await latestPublishedCpiMonth();
    const next = { ...current };
    const notes = [];
    if (isNewerPeriod(publishedCpi, storedCpiMonth(current))) {
      next.consumerPriceIndex = await fetchCpi();
      notes.push(`price index ${publishedCpi}`);
    }
    const publishedYear = await latestPublishedSurveyYear();
    if (isNewerPeriod(String(publishedYear), String(current?.householdBudgetSurvey?.year ?? ""))) {
      next.householdBudgetSurvey = await fetchSurvey(publishedYear);
      notes.push(`household survey ${publishedYear}`);
    }
    next.checked = today();
    if (notes.length) next.fetched = today();
    await saveBenchmarks(pool, next);
    console.log(notes.length
      ? `Statistics Finland updated: ${notes.join(", ")}`
      : `Statistics Finland is current (price index ${publishedCpi})`);
    return next;
  } catch (error) {
    console.warn("Statistics Finland was not checked:", error instanceof Error ? error.message : error);
    return current;
  }
}

async function main() {
  const [surveyYear, cpi] = await Promise.all([latestPublishedSurveyYear(), fetchCpi()]);
  const out = {
    source: "Statistics Finland (Tilastokeskus), PxWeb open data, CC BY 4.0",
    fetched: today(),
    checked: today(),
    householdBudgetSurvey: await fetchSurvey(surveyYear),
    consumerPriceIndex: cpi,
  };
  const pool = createPool();
  await saveBenchmarks(pool, out);
  await pool.end();
  console.log("Updated benchmarks in Postgres");
  console.log("35-44:", out.householdBudgetSurvey.byAge["35-44"]);
  const latest = storedCpiMonth(out);
  console.log("CPI 2022 avg", out.consumerPriceIndex.average2022, "latest", latest, out.consumerPriceIndex.monthly[latest]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
