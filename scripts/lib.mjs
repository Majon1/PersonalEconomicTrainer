// Shared helpers for the data scripts: basket rules, merchant names and CSV reading.

import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = join(ROOT, "data");

// Merchant category codes (MCC) -> human-readable merchant type.
export const MCC_NAMES = {
  5411: "Supermarket", 5422: "Butcher / fish shop", 5451: "Dairy / bakery",
  5499: "Kiosk / convenience store",
  5812: "Restaurant", 5813: "Bar / pub", 5814: "Café / fast food",
  4111: "Public transport", 4121: "Taxi", 5541: "Fuel station",
  5542: "Fuel (automated)", 7523: "Parking",
  5912: "Pharmacy", 8011: "Doctor", 8021: "Dentist", 8099: "Health services",
  5200: "Home supplies", 5251: "Hardware store", 5712: "Furniture",
  5732: "Electronics", 5734: "Software",
  5651: "Clothing", 5691: "Clothing", 5941: "Sports goods", 5942: "Books",
  5945: "Toys & games", 5999: "Specialty shop",
  7832: "Cinema", 7922: "Theatre & events", 7991: "Attractions",
  7996: "Amusement park", 7999: "Recreation",
  4511: "Flights", 4722: "Travel agency", 7011: "Hotel", 7512: "Car rental",
};

// Four baskets:
//   regular   - mandatory and regular (rent, bills, groceries, commuting)
//   irregular - mandatory but irregular (health, repairs, appliances)
//   everyday  - small habitual purchases that slip through your fingers
//               (coffees, quick lunches, snacks, taxis, parking)
//   extras    - bigger nice-to-haves you could live without if money got
//               tight (travel, hobbies, entertainment, shopping, big meals out)
export const SMALL_PURCHASE_EUR = 40;

const CATEGORY_BASKET = {
  "Housing": "regular",
  "Utilities": "regular",
  "Groceries": "regular",
  "Transportation": "regular",
  "Health": "irregular",
  "Home & Tech": "irregular",
  "Restaurants": "everyday",
  "Entertainment": "extras",
  "Lifestyle": "extras",
  "Travel": "extras",
};
// Merchant types decided by purchase size: small = slips through your fingers.
const SIZE_RULES = {
  // mcc: [basket if small, basket if big]
  5812: ["everyday", "extras"],  // restaurant: quick lunch vs. a dinner out
  5813: ["everyday", "extras"],  // bar / pub
  5814: ["everyday", "extras"],  // café / fast food
  4121: ["everyday", "extras"],  // taxi
  5499: ["everyday", "regular"], // kiosk snack vs. a grocery run
};
const MCC_BASKET = {
  7523: "everyday", // parking
};
const NON_SPENDING = {
  salary: "income",
  other_income: "income",
  investment_withdrawal: "income",
  investment_deposit: "saving",
  salary_sweep: "transfer",
};

export function basketFor(row) {
  const fixed = NON_SPENDING[row.transaction_type] ?? MCC_BASKET[row.mcc_code];
  if (fixed) return fixed;
  const size = SIZE_RULES[row.mcc_code];
  if (size) return Math.abs(Number(row.tx_amount_eur)) <= SMALL_PURCHASE_EUR ? size[0] : size[1];
  return CATEGORY_BASKET[row.category] ?? "extras";
}

/** Raw CSV row -> the transaction shape the app uses. */
export function toTransaction(r) {
  return {
    date: r.tx_date,
    time: r.tx_timestamp.slice(r.tx_timestamp.indexOf(":") + 1),
    category: r.category,
    amount: Number(r.tx_amount_eur),
    balance: Number(r.balance_after_eur),
    type: r.transaction_type,
    merchant: r.merchant_id,
    merchantType: MCC_NAMES[r.mcc_code] ?? "",
    basket: basketFor(r),
  };
}

// Minimal CSV line parser (handles quoted fields with commas and "" escapes).
export function parseLine(line) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export const stripBom = (s) => s.replace(/^﻿/, "");

export function readSmallCsv(name) {
  const lines = stripBom(readFileSync(join(DATA, name), "utf8")).split(/\r?\n/).filter(Boolean);
  const header = parseLine(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(parseLine(l).map((v, i) => [header[i], v])));
}

/**
 * Stream the big transactions file, calling onCustomer(customerId, rows) once
 * per customer (the file is sorted by customer). Optionally only for `ids`.
 */
export async function forEachCustomer(onCustomer, ids = null) {
  const wanted = ids ? new Set(ids) : null;
  const rl = createInterface({ input: createReadStream(join(DATA, "tx_junction_transactions.csv"), "utf8") });
  let header = null, current = null, rows = [];
  const flush = async () => {
    if (current && (!wanted || wanted.has(current))) await onCustomer(current, rows);
    rows = [];
  };
  for await (const raw of rl) {
    if (!header) { header = parseLine(stripBom(raw)); continue; }
    const id = raw.slice(0, raw.indexOf(","));
    if (id !== current) {
      await flush();
      current = id;
      if (wanted && ![...wanted].some((w) => w >= id)) break; // past the last wanted id
    }
    if (!wanted || wanted.has(id)) rows.push(Object.fromEntries(parseLine(raw).map((v, i) => [header[i], v])));
  }
  await flush();
  rl.close();
}
