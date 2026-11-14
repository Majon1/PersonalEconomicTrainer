// Postgres access. Customers, transactions and benchmarks come from DATABASE_URL.

import pg from "pg";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL && existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));

export const DEMO_CUSTOMERS = ["CUST01957", "CUST02663", "CUST02528"];

const MCC_NAMES = {
  5411: "Supermarket", 5422: "Butcher / fish shop", 5451: "Dairy / bakery",
  5499: "Kiosk",
  5812: "Restaurant", 5813: "Bar", 5814: "Café",
  4111: "Public transport", 4121: "Taxi", 5541: "Fuel",
  5542: "Fuel", 7523: "Parking",
  5912: "Pharmacy", 8011: "Doctor", 8021: "Dentist", 8099: "Health",
  5200: "Home supplies", 5251: "Hardware", 5712: "Furniture",
  5732: "Electronics", 5734: "Software",
  5651: "Clothing", 5691: "Clothing", 5941: "Sports", 5942: "Books",
  5945: "Toys", 5999: "Shop",
  7832: "Cinema", 7922: "Events", 7991: "Attractions",
  7999: "Recreation",
  4511: "Flights", 4722: "Travel agency", 7011: "Hotel", 7512: "Car rental",
};

export function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set. Add it to .env and restart.");
  // sslmode in the URL overrides the ssl option in pg v8, so remove it and
  // verify with the CA Aiven injects. Locally, without that cert, still encrypt.
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  const ca = process.env.PROJECT_CA_CERT
    ? Buffer.from(process.env.PROJECT_CA_CERT, "base64").toString()
    : undefined;
  return new Pool({
    connectionString: url.toString(),
    max: 5,
    ssl: ca ? { ca } : { rejectUnauthorized: false },
  });
}

export async function loadBenchmarks(pool) {
  const { rows } = await pool.query("SELECT payload FROM benchmarks WHERE id = 1");
  if (!rows[0]) throw new Error("No benchmarks row in the database.");
  return rows[0].payload;
}

export async function saveBenchmarks(pool, payload) {
  await pool.query(
    `INSERT INTO benchmarks (id, payload) VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`,
    [JSON.stringify(payload)],
  );
}

export async function loadCustomerIndex(pool, ids = DEMO_CUSTOMERS) {
  const { rows } = await pool.query(
    `SELECT c.customer_id, c.customer_age, c.customer_postal_code, count(t.id)::int AS transactions
     FROM customers c
     LEFT JOIN transactions t ON t.customer_id = c.customer_id
     WHERE c.customer_id = ANY($1::text[])
     GROUP BY c.customer_id, c.customer_age, c.customer_postal_code`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.customer_id, r]));
  const customers = ids.filter((id) => byId.has(id)).map((id) => {
    const r = byId.get(id);
    return { id: r.customer_id, age: r.customer_age, postalCode: r.customer_postal_code, transactions: r.transactions };
  });
  return { default: customers[0]?.id ?? null, customers };
}

function clockTime(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const h = String(value.getHours()).padStart(2, "0");
    const m = String(value.getMinutes()).padStart(2, "0");
    const s = String(value.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
  const text = String(value ?? "");
  // Postgres stores these as 01OCT24:14:11:10 (day, month, year, then clock).
  const bank = text.match(/^[0-9]{2}[A-Za-z]{3}[0-9]{2}:(\d{2}:\d{2}:\d{2})$/);
  if (bank) return bank[1];
  const match = text.match(/(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : "12:00:00";
}

function gameTransaction(row, customerId) {
  const amount = Number(row.tx_amount_eur);
  const mccNum = Number(row.mcc_code);
  const mcc = row.mcc_code ? String(row.mcc_code).padStart(4, "0") : "";
  const income = amount > 0;
  return {
    id: String(row.id),
    customerId,
    date: String(row.tx_date).slice(0, 10),
    time: clockTime(row.tx_timestamp),
    category: row.category || (income ? "Salary" : "Lifestyle"),
    amount,
    balanceAfter: Number(row.balance_after_eur),
    merchantId: row.merchant_id || `tx-${row.id}`,
    merchantType: MCC_NAMES[mccNum] || "",
    mcc,
    source: "sbank",
    type: row.transaction_type || "",
  };
}

export async function loadCustomer(pool, id) {
  const profile = await pool.query(
    "SELECT customer_id, customer_postal_code, customer_age FROM customers WHERE customer_id = $1",
    [id],
  );
  if (!profile.rows[0]) return null;
  const p = profile.rows[0];
  const tx = await pool.query(
    `SELECT id, tx_date::text AS tx_date, tx_timestamp, category,
            tx_amount_eur::text AS tx_amount_eur,
            balance_after_eur::text AS balance_after_eur,
            transaction_type,
            COALESCE(merchant_id, '') AS merchant_id,
            COALESCE(mcc_code, '') AS mcc_code
     FROM transactions
     WHERE customer_id = $1
     ORDER BY tx_date, tx_timestamp, id`,
    [id],
  );
  return {
    customer: {
      id: p.customer_id,
      age: p.customer_age,
      postalCode: p.customer_postal_code,
    },
    transactions: tx.rows.map((row) => gameTransaction(row, id)),
  };
}

// ---------------------------------------------------------------------------
// Mortgages: the customer's own application (if any) and what all 200
// applications in the data looked like.
// ---------------------------------------------------------------------------

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "13JUL26:07:49:55" -> "2026-07-13" */
function eventDate(stamp) {
  const m = /^(\d{2})([A-Z]{3})(\d{2})/.exec(String(stamp || ""));
  return m ? `20${m[3]}-${MONTHS[m[2]] || "01"}-${m[1]}` : null;
}

export async function loadMortgage(pool, customerId) {
  const app = await pool.query("SELECT * FROM mortgage_applications WHERE customer_id = $1", [customerId]);
  const a = app.rows[0];
  if (!a) return null;
  const ev = await pool.query(
    `SELECT event_timestamp, event_type, property_type, property_price_estimate, expense_type, expense_amount, decision, rejection_reason
     FROM mortgage_events WHERE mortgage_customer_id = $1`,
    [a.mortgage_customer_id],
  );
  const events = ev.rows
    .map((e) => ({ ...e, date: eventDate(e.event_timestamp) }))
    .sort((x, y) => String(x.date).localeCompare(String(y.date)));
  const num = (v) => (v == null ? null : Number(v));
  return {
    id: a.mortgage_customer_id,
    decision: a.final_decision,
    rejectionReason: a.rejection_reason || null,
    propertyPrice: num(a.final_property_price_eur),
    loan: num(a.final_requested_loan_eur),
    equity: num(a.final_equity_amount_eur),
    collateralValue: num(a.final_collateral_value_eur),
    requiredMonthlyIncome: Math.round(num(a.required_monthly_income_eur) * 100) / 100,
    loanToValue: Math.round(num(a.final_loan_to_value) * 10000) / 10000,
    startedOn: events[0]?.date ?? null,
    decidedOn: [...events].reverse().find((e) => e.event_type === "loan_decision")?.date ?? null,
    propertiesViewed: new Set(events.filter((e) => e.event_type === "property_added").map((e) => e.property_price_estimate)).size,
    propertyTypes: [...new Set(events.map((e) => e.property_type).filter(Boolean))],
    contacts: events.filter((e) => e.event_type === "customer_contact").length,
    steps: events.length,
    expenses: events
      .filter((e) => e.expense_type)
      .map((e) => ({ date: e.date, type: e.expense_type, amount: num(e.expense_amount) })),
  };
}

// The tables the app writes to, created on start:
//   mikko_memory    one row per question Mikko asked a customer, with what they did
//   mikko_budgets   every budget a customer made; a new one ends the one before
//   mikko_progress  one row per customer: XP, level, coins and Locker items
export async function ensureUserTables(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS mikko_progress (
       customer_id text PRIMARY KEY,
       progress    jsonb NOT NULL,
       updated_at  timestamptz NOT NULL
     )`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS mikko_memory (
       customer_id text NOT NULL,
       quest_id    text NOT NULL,
       entry       jsonb NOT NULL,
       updated_at  timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (customer_id, quest_id)
     )`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS mikko_budgets (
       customer_id text NOT NULL,
       budget_id   text NOT NULL,
       limits      jsonb NOT NULL,
       created_at  timestamptz NOT NULL,
       ended_at    timestamptz,
       PRIMARY KEY (customer_id, budget_id)
     )`,
  );
}

export async function loadBudgets(pool, customerId) {
  const { rows } = await pool.query(
    `SELECT budget_id, limits, created_at, ended_at FROM mikko_budgets
     WHERE customer_id = $1 ORDER BY created_at, budget_id`,
    [customerId],
  );
  return rows.map((r) => ({
    id: r.budget_id,
    budget: r.limits,
    createdAt: r.created_at.toISOString(),
    ...(r.ended_at ? { endedAt: r.ended_at.toISOString() } : {}),
  }));
}

// Ending is final: a later write can end a budget, never reopen it.
export async function saveBudget(pool, customerId, saved) {
  await pool.query(
    `INSERT INTO mikko_budgets (customer_id, budget_id, limits, created_at, ended_at)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (customer_id, budget_id)
     DO UPDATE SET ended_at = LEAST(mikko_budgets.ended_at, EXCLUDED.ended_at)`,
    [customerId, saved.id, JSON.stringify(saved.budget), saved.createdAt, saved.endedAt ?? null],
  );
}

export async function clearBudgets(pool, customerId) {
  await pool.query("DELETE FROM mikko_budgets WHERE customer_id = $1", [customerId]);
}

export async function loadProgress(pool, customerId) {
  const { rows } = await pool.query(
    "SELECT progress, updated_at FROM mikko_progress WHERE customer_id = $1",
    [customerId],
  );
  return rows[0] ? { progress: rows[0].progress, at: rows[0].updated_at.toISOString() } : null;
}

// The newest write wins, so a stale tab can't roll XP back. Returns whether it was stored.
export async function saveProgress(pool, customerId, progress, at) {
  const { rowCount } = await pool.query(
    `INSERT INTO mikko_progress (customer_id, progress, updated_at)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (customer_id)
     DO UPDATE SET progress = EXCLUDED.progress, updated_at = EXCLUDED.updated_at
     WHERE mikko_progress.updated_at <= EXCLUDED.updated_at`,
    [customerId, JSON.stringify(progress), at],
  );
  return rowCount > 0;
}

export async function clearProgress(pool, customerId) {
  await pool.query("DELETE FROM mikko_progress WHERE customer_id = $1", [customerId]);
}

export async function loadMemory(pool, customerId) {
  const { rows } = await pool.query(
    "SELECT entry FROM mikko_memory WHERE customer_id = $1 ORDER BY updated_at, quest_id",
    [customerId],
  );
  return rows.map((r) => r.entry);
}

export async function saveMemoryEntry(pool, customerId, entry) {
  await pool.query(
    `INSERT INTO mikko_memory (customer_id, quest_id, entry, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (customer_id, quest_id)
     DO UPDATE SET entry = EXCLUDED.entry, updated_at = now()`,
    [customerId, entry.questId, JSON.stringify(entry)],
  );
}

export async function clearMemory(pool, customerId) {
  await pool.query("DELETE FROM mikko_memory WHERE customer_id = $1", [customerId]);
}

let mortgageStats = null;
export async function loadMortgageStats(pool) {
  if (mortgageStats) return mortgageStats;
  const { rows } = await pool.query(
    `SELECT count(*)::int AS applications,
            count(*) FILTER (WHERE final_decision = 'approved')::int AS approved,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY final_property_price_eur::numeric)::float AS median_price,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY final_requested_loan_eur::numeric)::float AS median_loan,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY final_equity_amount_eur::numeric)::float AS median_equity,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY required_monthly_income_eur::numeric)::float AS median_required_income
     FROM mortgage_applications`,
  );
  const reasons = await pool.query(
    `SELECT rejection_reason AS reason, count(*)::int AS n FROM mortgage_applications
     WHERE rejection_reason IS NOT NULL AND rejection_reason <> '' GROUP BY 1 ORDER BY 2 DESC`,
  );
  const costs = await pool.query(
    `SELECT expense_type AS type, count(*)::int AS n, avg(expense_amount::numeric)::float AS average
     FROM mortgage_events WHERE expense_type IS NOT NULL AND expense_type <> '' GROUP BY 1 ORDER BY 3 DESC`,
  );
  const r = rows[0];
  mortgageStats = {
    applications: r.applications,
    approved: r.approved,
    medianPrice: Math.round(r.median_price),
    medianLoan: Math.round(r.median_loan),
    medianEquity: Math.round(r.median_equity),
    medianRequiredIncome: Math.round(r.median_required_income),
    rejectionReasons: reasons.rows,
    typicalCosts: costs.rows.map((c) => ({ type: c.type, count: c.n, average: Math.round(c.average) })),
  };
  return mortgageStats;
}
