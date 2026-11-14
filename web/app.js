import { createEngine, BASKETS, SPEND_KEYS, describe, defaultCategoryBaskets } from "./finance.js";
import { avatarSvg, MOOD_TEXT } from "./avatar.js";

// ---------- load data ----------
// Which customer: ?customer=ID, then the last one picked, then the default.
const INDEX = await fetch("data/customers/index.json").then((r) => r.json());
const known = new Set(INDEX.customers.map((c) => c.id));
let picked = new URLSearchParams(location.search).get("customer");
if (!known.has(picked)) { try { picked = localStorage.getItem("pet.customer"); } catch { picked = null; } }
export const customerId = known.has(picked) ? picked : INDEX.default;
const DATA = await fetch(`data/customers/${customerId}.json`).then((r) => r.json());
const BENCH = await fetch("/api/benchmarks").then((r) => (r.ok ? r.json() : null)).catch(() => null);

// ---------- user's own basket rules (MyData) ----------
const STORE_KEY = "pet.basketOverrides";
let overrides = {};
try { overrides = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch { overrides = {}; }
const saveOverrides = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(overrides)); } catch { /* private mode */ } };
export const getOverrides = () => ({ ...overrides });

let E = createEngine(DATA, { overrides, benchmarks: BENCH });

// ---------- formatting ----------
const eur0 = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt = (v) => eur0.format(Math.round(v));
export const fmt2 = (v) => eur2.format(v);
const pct = (v) => `${Math.round(v * 100)}%`;
const compact = (v) => (Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}K` : Math.round(v).toLocaleString("en-IE"));
export const monthName = (m, style = "long") =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: style, year: "numeric" });
const monthShort = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short" });
const dayName = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const color = (basket) => `var(--b-${basket})`;
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const $ = (id) => document.getElementById(id);

// ---------- state ----------
const state = { month: E.months[E.months.length - 1], filter: "all", habitBasket: "everyday" };

// ---------- tooltip ----------
const tip = $("tooltip");
export function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
export const hideTip = () => { tip.hidden = true; };
export const ttRow = (label, value, swatchColor, line = false) =>
  `<div class="tt-row"><span>${swatchColor ? `<i class="swatch${line ? " line" : ""}" style="background:${swatchColor}"></i>` : ""}${esc(label)}</span><span class="num">${value}</span></div>`;
export function hover(el, html) {
  el.addEventListener("mousemove", (e) => showTip(typeof html === "function" ? html() : html, e.clientX, e.clientY));
  el.addEventListener("mouseleave", hideTip);
}

// Average of the 12 months before `month` (fewer if not available).
function priorAverage(month) {
  const i = E.months.indexOf(month);
  const prior = E.months.slice(Math.max(0, i - 12), i).map((m) => E.MONTH_STATS[m]);
  if (!prior.length) return null;
  const avg = { n: prior.length };
  for (const k of ["income", "saving", "spend", ...SPEND_KEYS]) avg[k] = prior.reduce((a, s) => a + s[k], 0) / prior.length;
  return avg;
}

// ---------- header ----------
function renderHeader() {
  const c = DATA.customer;
  $("who").innerHTML = `<span>Age ${c.age}</span><span>Postal code ${esc(c.postalCode)}</span>`;
  $("asOf").textContent = `Based on ${E.txs.length.toLocaleString("en-IE")} transactions from ${dayName(E.firstDate)} to ${dayName(E.today)}.`;
  const cs = $("customerSelect");
  cs.innerHTML = INDEX.customers.map((x) => `<option value="${esc(x.id)}">${esc(x.id)} · age ${x.age}</option>`).join("");
  cs.value = customerId;
  cs.addEventListener("change", () => {
    try { localStorage.setItem("pet.customer", cs.value); } catch { /* private mode */ }
    const u = new URL(location.href);
    u.searchParams.set("customer", cs.value);
    u.searchParams.delete("ask");
    location.href = u.toString();
  });

  const sel = $("monthSelect");
  sel.innerHTML = [...E.months].reverse().map((m) => `<option value="${m}">${monthName(m)}</option>`).join("");
  sel.value = state.month;
  sel.addEventListener("change", () => setMonth(sel.value));
  if (!BENCH) {
    const n = $("notice");
    n.hidden = false;
    n.innerHTML = "Start the app with <code>npm start</code> and open <b>http://localhost:3000</b> to enable the chat and the Statistics Finland benchmarks.";
  }
}

function setMonth(m) {
  if (!E.months.includes(m)) return;
  state.month = m;
  $("monthSelect").value = m;
  renderMonth();
  renderMonthlyChart();
}

// ---------- headline ----------
function deltaHtml(cur, avg, upIsGood) {
  if (avg == null || Math.abs(avg) < 1) return `<div class="delta">&nbsp;</div>`;
  const d = (cur - avg) / Math.abs(avg);
  if (Math.abs(d) < 0.03) return `<div class="delta">About the same as your 12-month average</div>`;
  const up = d > 0;
  const cls = up ? (upIsGood ? "up-good" : "up-bad") : (upIsGood ? "down-bad" : "down-good");
  return `<div class="delta"><span class="${cls}">${up ? "▲" : "▼"} ${pct(Math.abs(d))}</span> vs 12-month average (${fmt(avg)})</div>`;
}

function renderHeadline(s, avg) {
  $("heroBalance").textContent = fmt(s.endBalance);
  $("heroSub").textContent = `At the end of ${monthName(s.month)}`;
  const rate = s.income > 0 ? (s.income - s.spend) / s.income : 0;
  const avgRate = avg && avg.income > 0 ? (avg.income - avg.spend) / avg.income : null;
  const tiles = [
    { label: "Money in", value: fmt(s.income), delta: deltaHtml(s.income, avg?.income, true) },
    { label: "Money spent", value: fmt(s.spend), delta: deltaHtml(s.spend, avg?.spend, false) },
    { label: "Moved to investments", value: fmt(s.saving), delta: deltaHtml(s.saving, avg?.saving, true) },
    {
      label: "Savings rate",
      value: pct(rate),
      delta: `<div class="delta">Share of income not spent${avgRate != null ? ` · 12-month avg ${pct(avgRate)}` : ""}</div>`,
    },
  ];
  $("tiles").innerHTML = tiles
    .map((t) => `<div class="tile"><div class="label">${t.label}</div><div class="tile-value">${t.value}</div>${t.delta}</div>`)
    .join("");
}

// ---------- three baskets ----------
function renderBaskets(s, avg) {
  const bar = $("segbar");
  const total = s.spend || 1;
  bar.innerHTML = SPEND_KEYS.filter((k) => s[k] > 0).map((k) => {
    const share = s[k] / total;
    return `<div class="seg" data-k="${k}" style="flex:${s[k]};background:${color(k)}" tabindex="0"
      aria-label="${BASKETS[k].name}: ${fmt(s[k])}, ${pct(share)}">${share >= 0.08 ? pct(share) : ""}</div>`;
  }).join("");
  bar.setAttribute("aria-label", `Spending in ${monthName(s.month)}: ` + SPEND_KEYS.map((k) => `${BASKETS[k].short} ${fmt(s[k])}`).join(", "));
  bar.querySelectorAll(".seg").forEach((el) => {
    const k = el.dataset.k;
    hover(el, `<div class="tt-title">${BASKETS[k].name}</div>${ttRow(monthName(s.month), fmt(s[k]), color(k))}${ttRow("Share of spending", pct(s[k] / total))}`);
  });
  $("segLegend").innerHTML = SPEND_KEYS
    .map((k) => `<span class="legend-item"><i class="swatch" style="background:${color(k)}"></i>${BASKETS[k].name}</span>`).join("");

  const allAvg = Object.fromEntries(SPEND_KEYS.map((k) => [k, E.months.reduce((a, m) => a + E.MONTH_STATS[m][k], 0) / E.months.length]));
  $("baskets").innerHTML = SPEND_KEYS.map((k) => {
    const top = Object.values(s.groups).filter((g) => g.basket === k).sort((a, b) => b.amount - a.amount).slice(0, 4);
    const n = s.count[k] || 0;
    let tipText = "";
    if (k === "regular") tipText = s.income > 0 ? `Your fixed costs take <b>${pct(s.regular / s.income)}</b> of your income this month.` : "";
    else if (k === "irregular") tipText = `Over ${E.months.length} months these costs averaged <b>${fmt(allAvg.irregular)}/month</b>. Put that aside every month, even when nothing breaks.`;
    else if (k === "everyday") tipText = `<b>${n} small purchases</b> this month. At this pace that's <b>${fmt(s.everyday * 12)} a year</b>. <a href="#sec-habits">See your habits</a>.`;
    else tipText = `If money got tight, this is what could pause. Over ${E.months.length} months it averaged <b>${fmt(allAvg.extras)}/month</b>.`;
    return `<article class="basket">
      <div class="basket-top"><i class="swatch" style="background:${color(k)}"></i><span class="basket-kicker">${BASKETS[k].short}</span></div>
      <h3 style="margin-top:6px">${BASKETS[k].name}</h3>
      <div class="basket-amount">${fmt(s[k])}</div>
      ${deltaHtml(s[k], avg?.[k], false)}
      <p class="basket-why">${BASKETS[k].why}</p>
      <ul class="mini-list">
        ${top.length ? top.map((g) => `<li><span>${esc(g.label)}</span><span class="num">${fmt(g.amount)}</span></li>`).join("")
          : `<li><span class="muted">Nothing this month</span><span></span></li>`}
      </ul>
      ${tipText ? `<div class="basket-tip">${tipText}</div>` : ""}
    </article>`;
  }).join("");
}

// ---------- categories ----------
function renderCategories(s) {
  const groups = Object.values(s.groups).sort((a, b) => b.amount - a.amount);
  const max = groups[0]?.amount || 1;
  $("catSub").textContent = `${monthName(s.month)}, coloured by basket.`;
  const list = $("catList");
  list.innerHTML = groups.map((g, i) => `
    <div class="cat-row" data-i="${i}">
      <div class="cat-name"><i class="swatch" style="background:${color(g.basket)}"></i><span>${esc(g.label)}</span></div>
      <div class="cat-track"><div class="cat-bar" style="width:${(g.amount / max) * 100}%;background:${color(g.basket)}"></div></div>
      <div class="num">${fmt(g.amount)}</div>
    </div>`).join("") || `<p class="muted">No spending this month.</p>`;
  list.querySelectorAll(".cat-row").forEach((row) => {
    const g = groups[row.dataset.i];
    hover(row, `<div class="tt-title">${esc(g.label)}</div>${ttRow(BASKETS[g.basket].name, fmt2(g.amount), color(g.basket))}${ttRow("Transactions", g.n)}${ttRow("Share of spending", pct(g.amount / s.spend))}`);
  });
}

// ---------- money buddy ----------
const MOOD_GLYPH = { happy: "✓", mild: "–", angry: "!" };
const MOOD_COLOR = { happy: "#0ca30c", mild: "#fab219", angry: "#d03b3b" };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
let currentMood = null;
export const getMood = () => currentMood;

function renderBuddy() {
  const md = E.mood(state.month);
  currentMood = md;
  const t = MOOD_TEXT[md.mood];
  $("buddyFigure").innerHTML = avatarSvg(md.mood, 132, `Money buddy is ${md.mood} about ${monthName(state.month)}`);
  $("buddyTitle").textContent = t.title;
  $("buddyLine").textContent = `${monthName(state.month)}: ${t.line}`;
  const items = [
    ...md.reasons.bad.map((r) => ["bad", "✕", r]),
    ...md.reasons.meh.map((r) => ["meh", "!", r]),
    ...md.reasons.good.slice(0, md.mood === "happy" ? 3 : 2).map((r) => ["good", "✓", r]),
  ];
  $("buddyReasons").innerHTML = items.map(([cls, g, r]) =>
    `<li><span class="ico ${cls}" aria-hidden="true">${g}</span><span>${esc(cap(r))}</span></li>`).join("");
  $("buddyScore").innerHTML = `<div class="label">Money mood score</div>
    <div class="score-row"><span class="score-value">${md.score}</span><span class="muted">/ 100 · ${md.mood}</span></div>
    <div class="score-track"><div class="score-fill" style="width:${md.score}%;background:${MOOD_COLOR[md.mood]}"></div></div>`;

  const strip = $("moodStrip");
  strip.innerHTML = E.months.map((m) => {
    const x = E.mood(m);
    return `<button class="mood-dot ${x.mood} ${m === state.month ? "sel" : ""}" data-m="${m}"
      aria-label="${monthName(m)}: ${x.mood}, score ${x.score}">${MOOD_GLYPH[x.mood]}</button>`;
  }).join("");
  strip.querySelectorAll(".mood-dot").forEach((b) => {
    const x = E.mood(b.dataset.m);
    hover(b, `<div class="tt-title">${monthName(b.dataset.m)}</div>${ttRow(cap(x.mood), `${x.score}/100`, MOOD_COLOR[x.mood])}`);
    b.addEventListener("click", () => setMonth(b.dataset.m));
  });
  document.dispatchEvent(new CustomEvent("mood-change", { detail: md }));
}

// ---------- where it really goes ----------
function renderHabits() {
  const k = state.habitBasket;
  const h = E.habits({ baskets: [k] });
  $("habitTabs").innerHTML = ["everyday", "extras"].map((b) =>
    `<button class="chip" data-b="${b}" aria-pressed="${b === k}"><i class="swatch" style="background:${color(b)}"></i>${BASKETS[b].name}</button>`).join("");
  $("habitTabs").querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => { state.habitBasket = b.dataset.b; renderHabits(); }));
  $("habitSub").textContent = k === "everyday"
    ? `Small purchases (up to ${h.small_purchase_limit_eur} €) you barely notice, over the last 12 months. Each one is tiny; the yearly total isn't.`
    : "Bigger nice-to-haves over the last 12 months: what you could pause if money got tight.";
  $("habitSummary").innerHTML = [
    ["Purchases a month", Math.round(h.purchases_per_month)],
    ["Per month", fmt(h.monthly_eur)],
    ["Per year", fmt(h.yearly_eur)],
    ["Share of all spending", `${h.share_of_all_spending_pct}%`],
  ].map(([l, v]) => `<div class="tile"><div class="label">${l}</div><div class="tile-value">${v}</div></div>`).join("");
  const max = h.habits[0]?.yearly_eur || 1;
  const trend = (t) => (t == null ? `<span class="muted">new</span>`
    : Math.abs(t) < 10 ? `<span class="muted">steady</span>`
    : `<span class="${t > 0 ? "trend-up" : "trend-down"}">${t > 0 ? "▲" : "▼"} ${Math.abs(t)}%</span>`);
  $("habitTable").innerHTML = `<thead><tr><th>Habit</th><th class="r">Times / month</th><th class="r">Typical purchase</th><th>Per year</th><th>Last 3 months vs. 3 before</th><th>Most often on</th></tr></thead>
    <tbody>${h.habits.map((x) => `<tr>
      <td>${esc(x.habit)}</td>
      <td class="r">${x.times_per_month.toLocaleString("en-IE", { maximumFractionDigits: 1 })}</td>
      <td class="r">${fmt2(x.typical_purchase_eur)}</td>
      <td class="num"><span class="habit-bar" style="width:${(x.yearly_eur / max) * 90}px;background:${color(k)}"></span>${fmt(x.yearly_eur)}</td>
      <td>${trend(x.trend_last_3_vs_previous_3_months_pct)}</td>
      <td class="muted">${esc(x.most_common_day || "")}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="muted">Nothing in this basket.</td></tr>`}</tbody>`;
}

// ---------- Finland benchmark ----------
function renderFinland() {
  const sec = $("sec-finland");
  if (!BENCH) { sec.hidden = true; return; }
  const b = E.benchmark();
  $("fiSub").textContent = `Your average month over the last 12 months compared with ${b.comparison_group}, per adult. ${b.price_adjustment}.`;
  $("fiLegend").innerHTML =
    `<span class="legend-item"><i class="swatch" style="background:var(--c-you)"></i>You</span>` +
    `<span class="legend-item"><i class="swatch" style="background:var(--c-ref)"></i>Finland, age ${esc(b.summary.group)}</span>`;
  const max = Math.max(...b.rows.flatMap((r) => [r.you_monthly_eur, r.finland_monthly_eur]));
  const rows = [...b.rows].sort((a, c) => c.you_monthly_eur - a.you_monthly_eur);
  $("fiList").innerHTML = rows.map((r) => {
    const d = r.difference_eur;
    const diff = Math.abs(d) < 5 ? `<span class="muted">about the same</span>` : `<span class="${d > 0 ? "up-bad" : "down-good"}">${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}</span>`;
    return `<div class="fi-row">
      <div><div>${esc(r.category)}</div><div class="fi-diff delta">${diff}</div></div>
      <div class="bars">
        <div class="bar-row"><div class="bar" style="width:${(r.you_monthly_eur / max) * 80}%;background:var(--c-you)"></div><span class="val">${fmt(r.you_monthly_eur)}</span></div>
        <div class="bar-row"><div class="bar" style="width:${(r.finland_monthly_eur / max) * 80}%;background:var(--c-ref)"></div><span class="val">${fmt(r.finland_monthly_eur)}</span></div>
      </div>
    </div>`;
  }).join("");
  $("fiSource").innerHTML = `${esc(b.caveats[0])} Source: <a href="${BENCH.householdBudgetSurvey.url}" target="_blank" rel="noopener">Statistics Finland, Household Budget Survey 2022</a> and <a href="${BENCH.consumerPriceIndex.url}" target="_blank" rel="noopener">Consumer Price Index</a>, CC BY 4.0.`;
}

// ---------- transactions ----------
const FILTERS = [
  { key: "all", label: "All" },
  { key: "regular", label: "Regular" },
  { key: "irregular", label: "Irregular" },
  { key: "everyday", label: "Everyday" },
  { key: "extras", label: "Extras" },
  { key: "money", label: "Income & investing" },
];
function basketTag(t) {
  if (SPEND_KEYS.includes(t.basket)) return `<span class="tag"><i class="swatch" style="background:${color(t.basket)}"></i>${BASKETS[t.basket].short}</span>`;
  const label = { income: "Income", saving: "Investing", transfer: "Transfer" }[t.basket] || t.basket;
  return `<span class="tag muted">${label}</span>`;
}
function renderTransactions() {
  const all = E.txs.filter((t) => t.date.startsWith(state.month));
  const rows = all.filter((t) => (state.filter === "all" ? true
    : state.filter === "money" ? !SPEND_KEYS.includes(t.basket) : t.basket === state.filter)).reverse();
  $("txFilters").innerHTML = FILTERS.map((f) =>
    `<button class="chip" data-f="${f.key}" aria-pressed="${state.filter === f.key}">${
      SPEND_KEYS.includes(f.key) ? `<i class="swatch" style="background:${color(f.key)}"></i>` : ""}${f.label}</button>`).join("");
  document.querySelectorAll("#txFilters .chip").forEach((b) =>
    b.addEventListener("click", () => { state.filter = b.dataset.f; renderTransactions(); }));
  $("txSub").textContent = `${rows.length} of ${all.length} transactions in ${monthName(state.month)}`;
  $("txTable").innerHTML = `
    <thead><tr><th>Date</th><th>What</th><th>Category</th><th>Basket</th><th class="r">Amount</th><th class="r">Balance after</th></tr></thead>
    <tbody>${rows.map((t) => `<tr>
      <td class="num">${dayName(t.date)}</td>
      <td>${esc(describe(t))}</td>
      <td class="muted">${esc(t.category)}</td>
      <td>${basketTag(t)}</td>
      <td class="r ${t.amount > 0 ? "amount-pos" : ""}">${t.amount > 0 ? "+" : ""}${fmt2(t.amount)}</td>
      <td class="r muted">${fmt2(t.balance)}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="muted">No transactions match.</td></tr>`}</tbody>`;
}

// ---------- mortgage ----------
function renderMortgage() {
  const m = DATA.mortgage;
  if (!m) return;
  const card = $("mortgageCard");
  card.hidden = false;
  const avgIncome = E.averages("last_12_months").income;
  const approved = m.decision === "approved";
  const cover = avgIncome / m.requiredMonthlyIncome;
  card.innerHTML = `
    <div class="card-head wrap-row">
      <div><h2>Your mortgage application</h2><p class="muted">Final result of application ${esc(m.id)}.</p></div>
      <span class="status-pill"><span class="dot" style="background:${approved ? "#0ca30c" : "#d03b3b"}"></span>${approved ? "✓ Approved" : "✕ Rejected"}${m.rejectionReason ? ` · ${esc(m.rejectionReason.replace(/_/g, " "))}` : ""}</span>
    </div>
    <div class="mortgage-grid">
      <div class="tile"><div class="label">Property price</div><div class="tile-value">${fmt(m.propertyPrice)}</div></div>
      <div class="tile"><div class="label">Loan</div><div class="tile-value">${fmt(m.loan)}</div><div class="delta">Loan-to-value ${pct(m.loanToValue)}</div></div>
      <div class="tile"><div class="label">Own equity</div><div class="tile-value">${fmt(m.equity)}</div><div class="delta">${pct(m.equity / m.propertyPrice)} of the price</div></div>
      <div class="tile"><div class="label">Required monthly income</div><div class="tile-value">${fmt(m.requiredMonthlyIncome)}</div>
        <div class="delta">Your last-12-month average is ${fmt(avgIncome)} (<span class="${cover >= 1 ? "up-good" : "down-bad"}">${pct(cover)}</span> of required)</div></div>
    </div>`;
}

// ---------- MyData ----------
function renderMyData() {
  const c = DATA.customer;
  const counts = {};
  for (const t of E.txs) counts[t.basket] = (counts[t.basket] || 0) + 1;
  const facts = [
    ["Customer ID", c.id], ["Account", c.accountId], ["Age", c.age], ["Postal code", c.postalCode],
    ["Transactions", E.txs.length.toLocaleString("en-IE")], ["Period", `${dayName(E.firstDate)} – ${dayName(E.today)}`],
    ["Categories", E.categories.length], ["Merchant types", E.merchantTypes.length],
    ["Mortgage application", DATA.mortgage ? `${DATA.mortgage.id} (${DATA.mortgage.decision})` : "none"],
  ];
  $("facts").innerHTML = facts.map(([k, v]) => `<li><span>${esc(k)}</span><span>${esc(v)}</span></li>`).join("");

  // Rule table: categories with their merchant types underneath.
  // Select values: a basket, or "category" (= follow the category) for merchant types.
  const catDefault = defaultCategoryBaskets(DATA.transactions);
  const mtCounts = {}, perCat = {};
  for (const t of DATA.transactions) {
    if (!SPEND_KEYS.includes(t.basket)) continue;
    perCat[t.category] = (perCat[t.category] || 0) - t.amount;
    if (!t.merchantType) continue;
    const k = `${t.category}|${t.merchantType}`;
    mtCounts[k] ??= {};
    mtCounts[k][t.basket] = (mtCounts[k][t.basket] || 0) + 1;
  }
  // A merchant type's built-in rule is its most common basket; size-split types
  // (e.g. cafés: small = everyday, over 40 € = extras) show as "Same as category".
  const mtBuiltIn = Object.fromEntries(Object.entries(mtCounts).map(([k, c]) => {
    const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
    return [k, top === catDefault[k.split("|")[0]] ? "category" : top];
  }));
  const n = E.months.length;
  const opt = (sel, inherit) =>
    (inherit ? `<option value="category" ${sel === "category" ? "selected" : ""}>Same as category</option>` : "") +
    SPEND_KEYS.map((k) => `<option value="${k}" ${sel === k ? "selected" : ""}>${BASKETS[k].short}</option>`).join("");
  let html = `<thead><tr><th>Category / merchant type</th><th class="r">Avg / month</th><th>Basket</th></tr></thead><tbody>`;
  for (const cat of Object.keys(catDefault).sort()) {
    const ov = overrides[`cat:${cat}`];
    html += `<tr class="${ov ? "changed" : ""}"><td><b>${esc(cat)}</b></td><td class="r">${fmt(perCat[cat] / n)}</td>
      <td><select data-key="cat:${esc(cat)}" data-default="${catDefault[cat]}" aria-label="Basket for ${esc(cat)}">${opt(ov || catDefault[cat])}</select></td></tr>`;
    const mts = Object.keys(mtBuiltIn).filter((k) => k.startsWith(`${cat}|`)).map((k) => k.slice(cat.length + 1)).sort();
    for (const mt of mts) {
      const builtIn = mtBuiltIn[`${cat}|${mt}`];
      const mov = overrides[`mt:${mt}`];
      html += `<tr class="sub ${mov ? "changed" : ""}"><td>${esc(mt)}</td><td></td>
        <td><select data-key="mt:${esc(mt)}" data-default="${builtIn}" aria-label="Basket for ${esc(mt)}">${opt(mov || builtIn, true)}</select></td></tr>`;
    }
  }
  $("rules").innerHTML = html + "</tbody>";
  $("rules").querySelectorAll("select").forEach((s) => s.addEventListener("change", () => {
    if (s.value === s.dataset.default) delete overrides[s.dataset.key];
    else overrides[s.dataset.key] = s.value;
    saveOverrides();
    rebuild();
  }));
}

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function setupDownloads() {
  $("dlJson").addEventListener("click", () => download(`${DATA.customer.id}-my-data.json`,
    JSON.stringify({ ...DATA, basketRules: overrides, transactions: E.txs.map(({ spend, ...t }) => t) }, null, 2), "application/json"));
  $("dlCsv").addEventListener("click", () => {
    const cols = ["date", "time", "category", "merchantType", "merchant", "type", "basket", "amount", "balance"];
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    download(`${DATA.customer.id}-transactions.csv`, [cols.join(","), ...E.txs.map((t) => cols.map((c) => q(t[c] ?? "")).join(","))].join("\n"), "text/csv");
  });
  $("resetBaskets").addEventListener("click", () => { overrides = {}; saveOverrides(); rebuild(); });
}

// ---------- SVG helpers ----------
const NS = "http://www.w3.org/2000/svg";
export function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}
export function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v || 1));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
export function topRoundedRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
export { compact };

// ---------- monthly stacked chart ----------
function renderMonthlyChart() {
  const host = $("monthlyChart");
  host.innerHTML = "";
  const W = host.clientWidth || 800, H = 280;
  const m = { t: 12, r: 8, b: 28, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const stats = E.months.map((x) => E.MONTH_STATS[x]);
  const max = niceMax(Math.max(...stats.map((s) => Math.max(s.spend, s.income))));
  const y = (v) => m.t + ih - (v / max) * ih;
  const band = iw / E.months.length;
  const bw = Math.min(24, band * 0.62);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H + 10}`, height: H + 10, role: "img", "aria-label": "Monthly spending per basket and income" }, host);
  const selIdx = E.months.indexOf(state.month);
  el("rect", { x: m.l + selIdx * band, y: m.t, width: band, height: ih, class: "sel-band", rx: 6 }, svg);
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    el("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: i === 0 ? "baseline" : "gridline" }, svg);
    el("text", { x: m.l - 8, y: yy + 4, "text-anchor": "end" }, svg).textContent = compact(v);
  }
  const surface = cssVar("--surface");
  stats.forEach((s, i) => {
    const cx = m.l + i * band + band / 2;
    let base = 0;
    const visible = SPEND_KEYS.filter((k) => s[k] > 0);
    visible.forEach((k, j) => {
      const y0 = y(base), y1 = y(base + s[k]);
      const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
      if (h > 0) {
        if (j === visible.length - 1) el("path", { d: topRoundedRect(cx - bw / 2, y1, bw, h, 4), fill: color(k) }, svg);
        else el("rect", { x: cx - bw / 2, y: y1, width: bw, height: h, fill: color(k) }, svg);
      }
      base += s[k];
    });
    const every = band < 16 ? 3 : band < 28 ? 2 : 1;
    const nearSel = i !== selIdx && Math.abs(i - selIdx) < every;
    if ((i % every === 0 && !nearSel) || i === selIdx) {
      const t = el("text", { x: cx, y: H - 10, "text-anchor": "middle" }, svg);
      t.textContent = monthShort(E.months[i]);
      if (i === selIdx) t.setAttribute("style", `fill:${cssVar("--ink")};font-weight:600`);
    }
    if (E.months[i].endsWith("-01")) el("text", { x: cx, y: H + 4, "text-anchor": "middle" }, svg).textContent = E.months[i].slice(0, 4);
  });
  const pts = stats.map((s, i) => [m.l + i * band + band / 2, y(s.income)]);
  el("path", { d: "M" + pts.map((p) => p.join(",")).join("L"), fill: "none", stroke: color("income"), "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  const last = pts[pts.length - 1];
  el("circle", { cx: last[0], cy: last[1], r: 4, fill: color("income"), stroke: surface, "stroke-width": 2 }, svg);
  stats.forEach((s, i) => {
    const r = el("rect", { x: m.l + i * band, y: m.t, width: band, height: ih, class: "hit", tabindex: 0,
      "aria-label": `${monthName(s.month)}: income ${fmt(s.income)}, spent ${fmt(s.spend)}` }, svg);
    hover(r, `<div class="tt-title">${monthName(s.month)}</div>` + ttRow("Income", fmt(s.income), color("income"), true) +
      SPEND_KEYS.slice().reverse().map((k) => ttRow(BASKETS[k].short, fmt(s[k]), color(k))).join("") +
      `<div class="tt-row tt-total"><span>Total spent</span><span class="num">${fmt(s.spend)}</span></div>`);
    r.addEventListener("click", () => setMonth(s.month));
    r.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMonth(s.month); } });
  });
  $("monthlyLegend").innerHTML =
    `<span class="legend-item"><i class="swatch line" style="background:${color("income")}"></i>Income</span>` +
    SPEND_KEYS.map((k) => `<span class="legend-item"><i class="swatch" style="background:${color(k)}"></i>${BASKETS[k].name}</span>`).join("");
}

function renderMonthlyTable() {
  $("monthlyTable").innerHTML = `
    <thead><tr><th>Month</th><th class="r">Income</th><th class="r">Regular</th><th class="r">Irregular</th><th class="r">Everyday</th><th class="r">Extras</th><th class="r">Total spent</th><th class="r">To investments</th><th class="r">End balance</th></tr></thead>
    <tbody>${E.months.slice().reverse().map((mm) => {
      const s = E.MONTH_STATS[mm];
      return `<tr><td>${monthName(mm, "short")}</td><td class="r">${fmt(s.income)}</td><td class="r">${fmt(s.regular)}</td><td class="r">${fmt(s.irregular)}</td><td class="r">${fmt(s.everyday)}</td><td class="r">${fmt(s.extras)}</td><td class="r">${fmt(s.spend)}</td><td class="r">${fmt(s.saving)}</td><td class="r">${fmt(s.endBalance)}</td></tr>`;
    }).join("")}</tbody>`;
}

// ---------- balance line chart ----------
function renderBalanceChart() {
  const host = $("balanceChart");
  host.innerHTML = "";
  const W = host.clientWidth || 500, H = 240;
  const m = { t: 12, r: 12, b: 28, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const byDay = new Map();
  for (const t of E.txs) byDay.set(t.date, t.balance);
  const days = [...byDay.entries()];
  const t0 = Date.parse(days[0][0]), t1 = Date.parse(days[days.length - 1][0]);
  const rawMin = Math.min(0, ...days.map((d) => d[1])), rawMax = Math.max(...days.map((d) => d[1]));
  const p = 10 ** Math.floor(Math.log10((rawMax - rawMin) / 4));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s * 4 >= rawMax - rawMin);
  const minV = Math.floor(rawMin / step) * step, maxV = Math.ceil(rawMax / step) * step;
  const x = (d) => m.l + ((Date.parse(d) - t0) / (t1 - t0)) * iw;
  const y = (v) => m.t + ih - ((v - minV) / (maxV - minV)) * ih;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": `Account balance over time, from ${fmt(days[0][1])} to ${fmt(days[days.length - 1][1])}` }, host);
  for (let v = minV; v <= maxV + 1e-6; v += step) {
    const yy = y(v);
    el("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: v === 0 ? "baseline" : "gridline" }, svg);
    el("text", { x: m.l - 8, y: yy + 4, "text-anchor": "end" }, svg).textContent = compact(v);
  }
  const tickRe = iw < 420 ? /-(01|07)$/ : /-(01|04|07|10)$/;
  E.months.forEach((mm) => {
    if (!tickRe.test(mm)) return;
    const xx = x(`${mm}-01`);
    if (xx < m.l || xx > W - m.r) return;
    el("text", { x: xx, y: H - 8, "text-anchor": "middle" }, svg).textContent =
      new Date(`${mm}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  });
  const d = days.map(([dd, v], i) => `${i ? "L" : "M"}${x(dd).toFixed(1)},${y(v).toFixed(1)}`).join("");
  el("path", { d: `${d}L${x(days[days.length - 1][0])},${y(minV)}L${x(days[0][0])},${y(minV)}Z`, fill: color("regular"), "fill-opacity": 0.1 }, svg);
  el("path", { d, fill: "none", stroke: color("regular"), "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  const [ld, lv] = days[days.length - 1];
  el("circle", { cx: x(ld), cy: y(lv), r: 4, fill: color("regular"), stroke: cssVar("--surface"), "stroke-width": 2 }, svg);
  const cross = el("line", { y1: m.t, y2: m.t + ih, class: "crosshair", visibility: "hidden" }, svg);
  const dot = el("circle", { r: 4, fill: color("regular"), stroke: cssVar("--surface"), "stroke-width": 2, visibility: "hidden" }, svg);
  const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }, svg);
  hit.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect();
    const tt = t0 + ((((e.clientX - r.left) / r.width) * W - m.l) / iw) * (t1 - t0);
    let best = days[0];
    for (const dd of days) if (Math.abs(Date.parse(dd[0]) - tt) < Math.abs(Date.parse(best[0]) - tt)) best = dd;
    const bx = x(best[0]), by = y(best[1]);
    cross.setAttribute("x1", bx); cross.setAttribute("x2", bx); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", bx); dot.setAttribute("cy", by); dot.setAttribute("visibility", "visible");
    showTip(`<div class="tt-title">${dayName(best[0])}</div>${ttRow("Balance", fmt2(best[1]), color("regular"), true)}`, e.clientX, e.clientY);
  });
  hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); hideTip(); });
}

// ---------- orchestration ----------
function renderMonth() {
  const s = E.MONTH_STATS[state.month];
  const avg = priorAverage(state.month);
  renderBuddy();
  renderHeadline(s, avg);
  renderBaskets(s, avg);
  renderCategories(s);
  renderTransactions();
}
function rebuild() {
  E = createEngine(DATA, { overrides, benchmarks: BENCH });
  renderMonth();
  renderMonthlyChart();
  renderMonthlyTable();
  renderHabits();
  renderMyData();
}

/** Called by the chat: point the dashboard at a month / filter / section. */
export function applyDashboardAction(a) {
  if (a.month) setMonth(a.month);
  if (a.basket_filter) { state.filter = a.basket_filter; renderTransactions(); }
  const target = a.section && { status: "sec-status", buddy: "sec-buddy", baskets: "sec-baskets", habits: "sec-habits", monthly: "sec-monthly", categories: "sec-categories",
    finland: "sec-finland", transactions: "sec-transactions", mydata: "sec-mydata" }[a.section];
  if (target) $(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
export const hasServer = Boolean(BENCH);

renderHeader();
renderMonth();
renderMonthlyChart();
renderMonthlyTable();
renderBalanceChart();
renderHabits();
renderFinland();
renderMortgage();
renderMyData();
setupDownloads();

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { renderMonthlyChart(); renderBalanceChart(); }, 120);
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { renderMonthlyChart(); renderBalanceChart(); });
