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
