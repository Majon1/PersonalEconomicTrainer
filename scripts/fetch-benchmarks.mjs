// Download open benchmark data from Statistics Finland (PxWeb API, CC BY 4.0)
// and write data/benchmarks.json.
//
//  - Household budget survey 2022, table 14q4: consumption expenditure per
//    consumption unit per month, by age of the household reference person.
//  - Consumer price index (2025=100), table 15b5: monthly overall index,
//    used to lift 2022 euros to today's price level.
//
// Usage:  node scripts/fetch-benchmarks.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "benchmarks.json");
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

async function main() {
  // --- Household budget survey ---
  const codes = [...new Set(["0", ...Object.values(CATEGORY_COICOP).flat()])];
  const ages = ["SSS", "17-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75-84", "85-"];
  const hbs = await query("ktutk/14q4.px", {
    timeperiod_y: ["2022"],
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
        timeperiod_y: "2022", coicop_46_20231201: c, ikaryhma_10_20180101: age, contentscode: "kulukk_kt_hk_2_1",
      }) ?? 0), 0));
    }
    byAge[age === "SSS" ? "all" : age] = {
      total: Math.round(get({ timeperiod_y: "2022", coicop_46_20231201: "0", ikaryhma_10_20180101: age, contentscode: "kulukk_kt_hk_2_1" })),
      categories: cats,
    };
  }

  // --- Consumer price index ---
  const meta = await (await fetch(`${API}/khi/15b5.px`)).json();
  const months = meta.variables.find((v) => v.code === "timeperiod_m").values.filter((m) => m >= "2022M01");
  const cpi = await query("khi/15b5.px", {
    timeperiod_m: months, coicop_46_20231201: ["SSS"], contentscode: ["ip_khi", "vm_khi"],
  });
  const getCpi = cube(cpi);
  const cpiMonthly = Object.fromEntries(months.map((m) => [
    `${m.slice(0, 4)}-${m.slice(5)}`,
    {
      index: getCpi({ timeperiod_m: m, coicop_46_20231201: "SSS", contentscode: "ip_khi" }),
      annualChangePct: getCpi({ timeperiod_m: m, coicop_46_20231201: "SSS", contentscode: "vm_khi" }),
    },
  ]));
  const avg2022 = months.filter((m) => m.startsWith("2022"))
    .reduce((a, m) => a + cpiMonthly[`2022-${m.slice(5)}`].index, 0) / 12;

  const out = {
    source: "Statistics Finland (Tilastokeskus), PxWeb open data, CC BY 4.0",
    fetched: new Date().toISOString().slice(0, 10),
    householdBudgetSurvey: {
      table: "StatFin/ktutk/14q4 - Household consumption expenditure by age of reference person",
      url: "https://pxdata.stat.fi/PxWeb/pxweb/en/StatFin/StatFin__ktutk/statfin_ktutk_pxt_14q4.px/",
      year: 2022,
      unit: "EUR per consumption unit per month, current (2022) prices",
      note: "A consumption unit is roughly one adult (OECD modified scale), so these approximate the spending of a single adult.",
      categoryCoicop: CATEGORY_COICOP,
      byAge,
    },
    consumerPriceIndex: {
      table: "StatFin/khi/15b5 - Consumer Price Index (2025=100), monthly",
      url: "https://pxdata.stat.fi/PxWeb/pxweb/en/StatFin/StatFin__khi/statfin_khi_pxt_15b5.px/",
      average2022: Math.round(avg2022 * 100) / 100,
      monthly: cpiMonthly,
    },
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${OUT}`);
  console.log("35-44:", byAge["35-44"]);
  console.log("CPI 2022 avg", out.consumerPriceIndex.average2022, "latest", months.at(-1), cpiMonthly[`${months.at(-1).slice(0, 4)}-${months.at(-1).slice(5)}`]);
}

main().catch((e) => { console.error(e); process.exit(1); });
