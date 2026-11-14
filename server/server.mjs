// Personal Economic Trainer - local server.
// Serves the web app and runs the chat: Gemini answers by calling tools that
// compute everything from the user's own transactions.
//
//   node server/server.mjs      (reads GEMINI_API_KEY from .env)

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, BASKETS } from "../web/finance.js";
import { declarations, runTool } from "./tools.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-4-hydrogen";
// "medium": with this tool set and multi-turn history, "low" was found to
// return empty answers on follow-up questions (Nov 2026).
const THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL || "medium";
const FALLBACK_THINKING = { low: "medium", medium: "high", high: "high", xhigh: "xhigh" };
const API_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com";
const MAX_TOOL_ROUNDS = 8;

// All demo customers listed in web/data/customers/index.json.
const CUSTOMERS_DIR = join(WEB, "data", "customers");
const INDEX = JSON.parse(readFileSync(join(CUSTOMERS_DIR, "index.json"), "utf8"));
const CUSTOMERS = new Map(INDEX.customers.map((c) => [c.id, JSON.parse(readFileSync(join(CUSTOMERS_DIR, `${c.id}.json`), "utf8"))]));
const benchmarks = JSON.parse(readFileSync(join(ROOT, "data", "benchmarks.json"), "utf8"));

// ---------- system prompt ----------
function systemPrompt(engine, viewMonth) {
  const c = engine.data.customer;
  const md = engine.mood(engine.months.includes(viewMonth) ? viewMonth : undefined);
  return `You are the user's money mentor inside their bank app ("Personal Economic Trainer"): think of a relaxed,
experienced friend who happens to be good with money. Laid back, curious, a bit of dry humour, never preachy.
You help people understand their own money and draw their own conclusions; you don't hand out orders.
You are talking with the account owner about their OWN data. Today is ${engine.today} (the last day with data).
The data covers ${engine.firstDate} to ${engine.today}. The user is ${c.age} years old, postal code ${c.postalCode} (Finland).

THE BASKETS - the teaching frame. Every spending euro falls into one:
- regular = "${BASKETS.regular.name}": ${BASKETS.regular.why}
- irregular = "${BASKETS.irregular.name}": ${BASKETS.irregular.why}
- everyday = "${BASKETS.everyday.name}": ${BASKETS.everyday.why} (purchases up to 40 € at cafés, restaurants, bars, kiosks, taxis, plus parking)
- extras = "${BASKETS.extras.name}": ${BASKETS.extras.why} (also cafés/restaurants/taxis over 40 €)
The first three are the classic baskets; "extras" separates bigger nice-to-haves from the small leaks, so the
lesson stays clear: "everyday" is money you don't notice, "extras" is money you choose to spend.
Never call extras "unnecessary" or judge them; frame them as "could live without if money got tight".
The user may have moved categories between baskets themselves; the tools already apply their choices.

MONEY BUDDY: the app shows an avatar whose mood reflects the user's decisions in the month on screen.
happy = living within their means; mild = could make better choices (spent more than earned, everyday habits
jumped, thin buffer, little left to save); angry = bought things they couldn't afford (a flexible purchase that
left less than the rent and bills due before the next income, or went into the red). The dashboard currently shows
${md.month} and the buddy is ${md.mood} (score ${md.score}/100). If the user asks about the buddy, its mood or
how to cheer it up, call get_mood and explain the reasons in your relaxed mentor voice; for "angry", be honest
but kind and point to the specific purchase(s) and what was still due.

EMERGENCY FUND: a key good habit. Goal = money on the account covering 3 months of money going out
(get_emergency_fund). Reaching it makes the buddy happier; under one month is a gentle nudge. Celebrate progress,
and when relevant suggest small, steady transfers rather than big sacrifices. Investments don't count (not instant cash).

Categories in the data: ${engine.categories.join(", ")}.
Merchant types: ${engine.merchantTypes.join(", ")}.
Note: "taxi" is a merchant type (category Transportation); coffee/cafés are "Café / fast food" (category Restaurants); "dining out" = category Restaurants.

HOW YOU TALK (mentor, laid back)
- Conversational and relaxed, like chatting over coffee. Plain words, contractions, short sentences. Say "you".
- Keep it short: usually 2-5 sentences. Answer first, then one observation worth thinking about. Only use bullets
  when listing 3+ comparable things, and never stack bullet lists.
- Pick the 1-3 numbers that matter; leave the rest to charts and the dashboard. No number dumps.
- Mentor, don't lecture: notice patterns, explain why they matter, and let the user decide. Prefer "you might
  notice..." or "one thing that stands out..." over "you should...". No moralising, no guilt, no alarm.
- Give credit where it's due: if a habit is good, say so plainly. If something is creeping up, mention it calmly.
- Often end with a light, optional follow-up question that helps them reflect or dig deeper
  (e.g. "Want to see which days those café runs happen?"), but not every single time.
- No headings, no "Coach's insight:" labels, no corporate tone, no exclamation-mark overload.

RULES
- Never guess or do arithmetic in your head on raw data: get every number from a tool. If a tool can't answer, say so.
- Tie insights to the baskets when it helps understanding, without repeating the definitions every time.
- Use euros like "38 €" (or "38,34 €" when cents matter). Mention dates and periods explicitly ("in August 2026").
- When a chart would help (trends, comparisons, breakdowns), call show_chart. Don't repeat every charted number in text.
- When the user might want to dig deeper, use update_dashboard to point the dashboard next to the chat at the right month/section.
- For "what kind of spender am I": call get_spender_profile, then give a short, friendly persona name and 2-3 traits backed by the data, said casually.
- For "safe to spend": call safe_to_spend; lead with the budget view (sustainable weekly allowance for everyday + extras), then mention the balance view as a safety net.
- For "where does my money go / slip away / what do I spend on without noticing": call find_money_leaks and make the
  hidden cost tangible: "26 café visits a month at about 17 € = 5,300 € a year". Mention growing habits.
- For "what if money got tight" or "where could I cut": extras can pause first, everyday habits can be trimmed, the
  mandatory baskets stay. Use safe_to_spend's tight_month_view.
- For "what if": call what_if; translate the saving into something tangible (per year, fewer visits per month).
- When comparing with other Finns, call compare_to_finland and name the source (Statistics Finland, Household Budget Survey 2022, price-adjusted). Mention caveats briefly when relevant.
- Reply in the language the user writes in (Finnish, Swedish or English).
- Use simple Markdown only: **bold**, short bullet lists. No headings, no tables (use show_chart kind=table instead).
- You are a mentor, not a licensed financial advisor; avoid recommending specific investment products.`;
}

// ---------- Gemini ----------
// Interactions API, stateless (store: false): Google keeps nothing after the
// answer, so the server resends the whole conversation each time, including
// the model's own thought / function_call steps exactly as received.
const TOOLS = declarations.map((d) => ({ type: "function", ...d }));

async function interact(input, engine, thinkingLevel = THINKING_LEVEL) {
  const res = await fetch(`${API_BASE}/v1beta/interactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify({
      model: MODEL,
      input,
      system_instruction: systemPrompt(engine, engine.viewMonth),
      tools: TOOLS,
      generation_config: { thinking_level: thinkingLevel },
      store: false,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Gemini HTTP ${res.status}`);
  return json;
}

async function chat({ customerId, viewMonth, messages = [], overrides = {} }) {
  const customer = CUSTOMERS.get(customerId) || CUSTOMERS.get(INDEX.default);
  const engine = createEngine(customer, { overrides, benchmarks });
  engine.viewMonth = viewMonth;
  const input = messages
    .filter((m) => m.text)
    .slice(-20)
    .map((m) => ({ type: m.role === "user" ? "user_input" : "model_output", content: [{ type: "text", text: m.text }] }));
  const blocks = [], actions = [], trace = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let res = await interact(input, engine);
    // Safety net: an empty answer gets one retry with more thinking.
    if (!(res.steps || []).some((s) => s.type === "function_call" || s.type === "model_output")) {
      console.warn(`Empty answer at thinking_level=${THINKING_LEVEL}; retrying with ${FALLBACK_THINKING[THINKING_LEVEL]}`);
      res = await interact(input, engine, FALLBACK_THINKING[THINKING_LEVEL]);
    }
    const steps = res.steps || [];
    const calls = steps.filter((s) => s.type === "function_call");
    if (!calls.length) {
      const text = steps.filter((s) => s.type === "model_output")
        .flatMap((s) => s.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
      if (!text) {
        console.warn("Empty answer from model:", res.status);
        return { text: "Sorry, I couldn't come up with an answer. Could you rephrase the question?", blocks, actions, trace };
      }
      return { text, blocks, actions, trace };
    }
    input.push(...steps); // thought + function_call steps, unchanged (signatures included)
    for (const call of calls) {
      let out;
      try {
        out = runTool(engine, call.name, call.arguments || {});
      } catch (e) {
        out = { result: { error: e.message } };
      }
      if (out.block) blocks.push(out.block);
      if (out.action) actions.push(out.action);
      trace.push({ tool: call.name, args: call.arguments || {} });
      input.push({ type: "function_result", call_id: call.id, name: call.name, result: JSON.stringify(out.result) });
    }
  }
  return { text: "Sorry, that took too many steps. Could you ask in a simpler way?", blocks, actions, trace };
}

// ---------- HTTP ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/benchmarks") return send(res, 200, benchmarks);
    if (url.pathname === "/api/status") return send(res, 200, { ai: Boolean(API_KEY), model: MODEL });
    if (url.pathname === "/api/chat" && req.method === "POST") {
      if (!API_KEY) return send(res, 503, { error: "No GEMINI_API_KEY set. Add it to the .env file and restart the server." });
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 200_000) return send(res, 413, { error: "Request too large" });
      }
      const out = await chat(JSON.parse(raw || "{}"));
      return send(res, 200, out);
    }
    // static files from web/
    const path = normalize(join(WEB, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
    if (!path.startsWith(WEB)) return send(res, 403, "Forbidden", "text/plain");
    const file = await readFile(path).catch(() => null);
    if (!file) return send(res, 404, "Not found", "text/plain");
    return send(res, 200, file, TYPES[extname(path)] || "application/octet-stream");
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: e.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Personal Economic Trainer running at http://localhost:${PORT}`);
  console.log(API_KEY ? `Chat uses ${MODEL}` : "No GEMINI_API_KEY found: the dashboard works, chat is disabled until you add one to .env");
});
