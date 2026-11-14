// Serves the pixel coach and the Postgres / Gemini API on one port.
//   npm start

import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { answerWithGemini } from "./chat.ts";
import { refreshBenchmarksIfStale } from "../scripts/fetch-benchmarks.mjs";
import { buildFinlandBoard } from "./compare.ts";
import {
  clearBudgets,
  clearMemory,
  clearProgress,
  createPool,
  ensureUserTables,
  loadBenchmarks,
  loadBudgets,
  loadCustomer,
  loadCustomerIndex,
  loadMemory,
  loadMortgage,
  loadMortgageStats,
  loadProgress,
  saveBudget,
  saveMemoryEntry,
  saveProgress,
} from "./db.mjs";
import { sanitizeMemoryEntry, sanitizeProgress, sanitizeSavedBudget } from "../src/game/engine.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const pool = createPool();
let benchmarks = await loadBenchmarks(pool);
// The price index and household survey are already in Postgres. Once a day,
// check whether Statistics Finland has published a newer month or survey year.
const applyBenchmarks = (next: typeof benchmarks) => { benchmarks = next; };
refreshBenchmarksIfStale(pool, benchmarks).then(applyBenchmarks);
setInterval(() => { refreshBenchmarksIfStale(pool, benchmarks).then(applyBenchmarks); }, 60 * 60 * 1000);
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

// Memory and budgets are read on every question and every page load. Keep the
// demo customers' copies in memory and drop one when it is written.
const memoryCache = new Map<string, unknown[]>();
const budgetCache = new Map<string, unknown[]>();

async function cachedMemory(id: string) {
  if (!memoryCache.has(id)) memoryCache.set(id, await loadMemory(pool, id));
  return memoryCache.get(id) ?? [];
}

async function cachedBudgets(id: string) {
  if (!budgetCache.has(id)) budgetCache.set(id, await loadBudgets(pool, id));
  return budgetCache.get(id) ?? [];
}

// Without the tables (no CREATE rights, say) the app still runs; memory,
// budgets and progress then stay in the browser.
let userTablesReady = false;
try {
  await ensureUserTables(pool);
  userTablesReady = true;
} catch (error) {
  console.warn("Memory, budgets and progress stay in the browser: could not create the tables:", error instanceof Error ? error.message : error);
}

const userDataReady = userTablesReady
  ? Promise.all(index.customers.map(async (customer) => {
      try {
        await Promise.all([cachedMemory(customer.id), cachedBudgets(customer.id)]);
      } catch (error) {
        console.warn(`Could not preload ${customer.id}:`, error instanceof Error ? error.message : error);
      }
    }))
  : Promise.resolve();

const app = express();
app.use(express.json({ limit: "256kb" }));

app.get("/api/status", (_req, res) => {
  res.json({
    ai: Boolean(process.env.GEMINI_API_KEY),
    model: process.env.GEMINI_MODEL || "gemini-4-hydrogen",
    router: "gemini-decision-1",
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

// Home page: the customer's own mortgage application (or null) and what all
// applications in the data looked like.
app.get("/api/customers/:id/mortgage", async (req, res) => {
  try {
    const [application, stats] = await Promise.all([loadMortgage(pool, req.params.id), loadMortgageStats(pool)]);
    res.json({ application, stats });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load mortgage data." });
  }
});

// "You vs Finland" board, computed directly (no AI needed).
app.get("/api/customers/:id/compare", async (req, res) => {
  const data = await getCustomer(req.params.id);
  if (!data) return res.status(404).json({ error: "Customer not found" });
  const board = buildFinlandBoard({ customer: data.customer, transactions: data.transactions, benchmarks });
  if (!board) return res.status(503).json({ error: "No Statistics Finland figures for this age group." });
  res.json(board);
});

// Mikko's memory: what the customer did each time he asked about an expense.
app.get("/api/customers/:id/memory", async (req, res) => {
  if (!userTablesReady) return res.status(503).json({ error: "Memory is not stored on the server." });
  if (!(await getCustomer(req.params.id))) return res.status(404).json({ error: "Customer not found" });
  try {
    res.json({ memory: (await cachedMemory(req.params.id)).map(sanitizeMemoryEntry).filter(Boolean) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load Mikko's memory." });
  }
});

app.put("/api/customers/:id/memory", async (req, res) => {
  if (!userTablesReady) return res.status(503).json({ error: "Memory is not stored on the server." });
  if (!(await getCustomer(req.params.id))) return res.status(404).json({ error: "Customer not found" });
  const raw = Array.isArray(req.body?.entries) ? req.body.entries.slice(0, 200) : [];
  const entries = raw.map(sanitizeMemoryEntry).filter(Boolean);
  if (!entries.length) return res.status(400).json({ error: "No valid memory entries." });
  try {
    for (const entry of entries) await saveMemoryEntry(pool, req.params.id, entry);
    memoryCache.delete(req.params.id);
    res.json({ saved: entries.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not save Mikko's memory." });
  }
});

app.delete("/api/customers/:id/memory", async (req, res) => {
  if (!userTablesReady) return res.status(503).json({ error: "Memory is not stored on the server." });
  if (!(await getCustomer(req.params.id))) return res.status(404).json({ error: "Customer not found" });
  try {
    await clearMemory(pool, req.params.id);
    memoryCache.delete(req.params.id);
    res.json({ cleared: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not clear Mikko's memory." });
  }
});

// XP, level, coins and Locker items.
app.get("/api/customers/:id/progress", async (req, res) => {
  if (!userTablesReady) return res.status(503).json({ error: "Progress is not stored on the server." });
  if (!(await getCustomer(req.params.id))) return res.status(404).json({ error: "Customer not found" });
  try {
    const saved = await loadProgress(pool, req.params.id);
    const progress = saved && sanitizeProgress(saved.progress);
    res.json(progress ? { progress, at: saved.at } : { progress: null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load progress." });
  }
});

app.put("/api/customers/:id/progress", async (req, res) => {
  if (!userTablesReady) return res.status(503).json({ error: "Progress is not stored on the server." });
  if (!(await getCustomer(req.params.id))) return res.status(404).json({ error: "Customer not found" });
  const progress = sanitizeProgress(req.body?.progress);
  const at = Date.parse(req.body?.at);
  if (!progress || Number.isNaN(at)) return res.status(400).json({ error: "No valid progress." });
  try {
    // A client clock running ahead must not lock out later writes from other devices.
    const stamp = new Date(Math.min(at, Date.now())).toISOString();
    res.json({ saved: await saveProgress(pool, req.params.id, progress, stamp) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not save progress." });
  }
});

app.delete("/api/customers/:id/progress", async (req, res) => {
  if (!userTablesReady) return res.status(503).json({ error: "Progress is not stored on the server." });
  if (!(await getCustomer(req.params.id))) return res.status(404).json({ error: "Customer not found" });
  try {
    await clearProgress(pool, req.params.id);
    res.json({ cleared: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not clear progress." });
  }
});

// Every budget the customer made: the active one and the ones it replaced.
app.get("/api/customers/:id/budgets", async (req, res) => {
  if (!userTablesReady) return res.status(503).json({ error: "Budgets are not stored on the server." });
  if (!(await getCustomer(req.params.id))) return res.status(404).json({ error: "Customer not found" });
  try {
    res.json({ budgets: (await cachedBudgets(req.params.id)).map(sanitizeSavedBudget).filter(Boolean) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load budgets." });
  }
});

app.put("/api/customers/:id/budgets", async (req, res) => {
  if (!userTablesReady) return res.status(503).json({ error: "Budgets are not stored on the server." });
  if (!(await getCustomer(req.params.id))) return res.status(404).json({ error: "Customer not found" });
  const raw = Array.isArray(req.body?.budgets) ? req.body.budgets.slice(0, 100) : [];
  const budgets = raw.map(sanitizeSavedBudget).filter(Boolean);
  if (!budgets.length) return res.status(400).json({ error: "No valid budgets." });
  try {
    for (const saved of budgets) await saveBudget(pool, req.params.id, saved);
    budgetCache.delete(req.params.id);
    res.json({ saved: budgets.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not save budgets." });
  }
});

app.delete("/api/customers/:id/budgets", async (req, res) => {
  if (!userTablesReady) return res.status(503).json({ error: "Budgets are not stored on the server." });
  if (!(await getCustomer(req.params.id))) return res.status(404).json({ error: "Customer not found" });
  try {
    await clearBudgets(pool, req.params.id);
    budgetCache.delete(req.params.id);
    res.json({ cleared: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not clear budgets." });
  }
});

app.post("/api/chat", async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "No GEMINI_API_KEY in .env. Add it and restart." });
  }
  const body = req.body ?? {};
  const data = (await getCustomer(body.customerId)) || (await getCustomer(index.default));
  if (!data) return res.status(404).json({ error: "Customer not found" });
  try {
    const id = data.customer.id;
    const [memory, budgets] = userTablesReady
      ? await Promise.all([
          cachedMemory(id).catch(() => body.memory),
          cachedBudgets(id).catch(() => body.budgets),
        ])
      : [body.memory, body.budgets];
    const answer = await answerWithGemini({
      query: body.query,
      customer: data.customer,
      transactions: data.transactions,
      overrides: body.overrides,
      budget: body.budget,
      budgets,
      history: body.history,
      memory,
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

await userDataReady;

app.listen(PORT, HOST, () => {
  const model = process.env.GEMINI_MODEL || "gemini-4-hydrogen";
  console.log(`Mentor Mikko at http://localhost:${PORT}`);
  if (HOST === "0.0.0.0") console.log(`Also reachable on your network: http://<this computer's IP>:${PORT}`);
  console.log(process.env.GEMINI_API_KEY ? `Chat replies with ${model}; questions are routed by gemini-decision-1` : "No GEMINI_API_KEY: the coach loads, chat stays off");
});
