// Extract customers from the raw CSVs into web/data/customers/<ID>.json and
// write web/data/customers/index.json (the list the app's customer picker shows).
//
// Every spending transaction is sorted into one of four "baskets" (rules in
// scripts/lib.mjs). Non-spending rows are tagged as income, saving (money moved
// to investments) or transfer.
//
// Usage:  node scripts/build-customer.mjs CUST01957 [CUST00002 ...]
//         (the first one is the default customer)

import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, readSmallCsv, forEachCustomer, toTransaction } from "./lib.mjs";

const OUT_DIR = join(ROOT, "web", "data", "customers");
const DEFAULT_CUSTOMERS = ["CUST01957"];

async function main(ids) {
  const profiles = new Map(readSmallCsv("tx_customers_junction.csv").map((r) => [r.customer_id, r]));
  const mortgages = new Map(readSmallCsv("mtg_tx_customer_link_and_final_mtg_infio.csv").map((r) => [r.customer_id, r]));
  for (const id of ids) if (!profiles.has(id)) { console.error(`Customer ${id} not found`); process.exit(1); }

  mkdirSync(OUT_DIR, { recursive: true });
  const index = [];
  const found = new Map();
  await forEachCustomer(async (id, rows) => { found.set(id, rows); }, ids);

  for (const id of ids) {
    const rows = found.get(id) || [];
    const profile = profiles.get(id);
    const m = mortgages.get(id);
    const out = {
      customer: {
        id,
        age: Number(profile.customer_age),
        postalCode: profile.customer_postal_code,
        accountId: rows[0]?.bank_account_id ?? null,
      },
      mortgage: m ? {
        id: m.mortgage_customer_id,
        decision: m.final_decision,
        rejectionReason: m.rejection_reason || null,
        propertyPrice: Number(m.final_property_price_eur),
        loan: Number(m.final_requested_loan_eur),
        equity: Number(m.final_equity_amount_eur),
        collateralValue: Number(m.final_collateral_value_eur),
        requiredMonthlyIncome: Math.round(Number(m.required_monthly_income_eur) * 100) / 100,
        loanToValue: Math.round(Number(m.lfinal_loan_to_value) * 10000) / 10000,
      } : null,
      transactions: rows.map(toTransaction),
    };
    const file = join(OUT_DIR, `${id}.json`);
    writeFileSync(file, JSON.stringify(out) + "\n", "utf8");
    index.push({ id, age: out.customer.age, postalCode: out.customer.postalCode, transactions: out.transactions.length });
    console.log(`Wrote ${out.transactions.length} transactions for ${id} to ${relative(ROOT, file)}`);
  }
  writeFileSync(join(OUT_DIR, "index.json"), JSON.stringify({ default: ids[0], customers: index }, null, 2) + "\n", "utf8");
}

main(process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_CUSTOMERS);
