// Serves the pixel coach and the Postgres / Gemini API on one port.
//   npm start

import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { answerWithGemini } from "./chat.ts";
import { buildFinlandBoard } from "./compare.ts";
import { createPool, loadBenchmarks, loadCustomer, loadCustomerIndex } from "./db.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 3000);
const pool = createPool();
const benchmarks = await loadBenchmarks(pool);
const index = await loadCustomerIndex(pool);
const customers = new Map();

async function getCustomer(id: string | null | undefined) {
  if (!id) return null;
  if (customers.has(id)) return customers.get(id);
  const data = await loadCustomer(pool, id);
  if (data) customers.set(id, data);
  return data;
}

await Promise.all(index.customers.map((customer) => getCustomer(customer.id)));

const app = express();
app.use(express.json({ limit: "256kb" }));

app.get("/api/status", (_req, res) => {
  res.json({
    ai: Boolean(process.env.GEMINI_API_KEY),
    model: process.env.GEMINI_MODEL || "gemini-4-hydrogen",
  });
});

app.get("/api/customers", (_req, res) => {
  res.json(index);
});

app.get("/api/customers/:id", async (req, res) => {
  const data = await getCustomer(req.params.id);
  if (!data) return res.status(404).json({ error: "Customer not found" });
  res.json(data);
});

// "You vs Finland" board, computed directly (no AI needed).
app.get("/api/customers/:id/compare", async (req, res) => {
  const data = await getCustomer(req.params.id);
  if (!data) return res.status(404).json({ error: "Customer not found" });
  const board = buildFinlandBoard({ customer: data.customer, transactions: data.transactions, benchmarks });
  if (!board) return res.status(503).json({ error: "No Statistics Finland figures for this age group." });
  res.json(board);
});

app.post("/api/chat", async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "No GEMINI_API_KEY in .env. Add it and restart." });
  }
  const body = req.body ?? {};
  const data = (await getCustomer(body.customerId)) || (await getCustomer(index.default));
  if (!data) return res.status(404).json({ error: "Customer not found" });
  try {
    const answer = await answerWithGemini({
      query: body.query,
      customer: data.customer,
      transactions: data.transactions,
      overrides: body.overrides,
      budget: body.budget,
      history: body.history,
      benchmarks,
    });
    res.json(answer);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Gemini request failed";
    res.status(500).json({ error: message });
  }
});

if (process.env.NODE_ENV === "production" && existsSync(join(ROOT, "dist", "index.html"))) {
  app.use(express.static(join(ROOT, "dist")));
  app.get(/.*/, (_req, res) => {
    res.sendFile(join(ROOT, "dist", "index.html"));
  });
} else {
  const vite = await createViteServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(PORT, "0.0.0.0", () => {
  const model = process.env.GEMINI_MODEL || "gemini-4-hydrogen";
  console.log(`Personal Economic Trainer at http://localhost:${PORT}`);
  if (HOST === "0.0.0.0") console.log(`Also reachable on your network: http://<this computer's IP>:${PORT}`);
  console.log(process.env.GEMINI_API_KEY ? `Chat uses ${model}` : "No GEMINI_API_KEY: the coach loads, chat stays off");
});
