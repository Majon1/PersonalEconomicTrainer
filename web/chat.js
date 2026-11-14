import {
  getOverrides, applyDashboardAction, hasServer, esc, color, fmt, monthName,
  el, niceMax, topRoundedRect, compact, hover, ttRow, cssVar,
} from "./app.js";

const $ = (id) => document.getElementById(id);
const log = $("chatLog"), form = $("chatForm"), input = $("chatInput"), sendBtn = $("chatSend");
const chatPanel = $("chat");

const SUGGESTIONS = [
  "How much did I spend on taxis last month?",
  "What kind of spender am I?",
  "What is safe for me to spend this week?",
  "How much could I save if I reduced dining out by 20%?",
  "What do I spend on without noticing?",
  "What could I cut if money got tight?",
  "How do I compare with other Finns my age?",
];

const history = []; // [{role: "user"|"model", text}]
let busy = false;
let aiReady = false;

// ---------- open/close on narrow screens ----------
$("chatOpen").addEventListener("click", () => { chatPanel.classList.add("open"); input.focus(); });
$("chatClose").addEventListener("click", () => chatPanel.classList.remove("open"));

// ---------- status ----------
async function checkStatus() {
  const st = $("aiStatus");
  if (!hasServer) {
    st.textContent = "Offline: start the server with npm start.";
    return;
  }
  try {
    const s = await fetch("/api/status").then((r) => r.json());
    aiReady = s.ai;
    st.textContent = s.ai ? `Answers computed from your own data · ${s.model}` : "Add GEMINI_API_KEY to .env and restart to enable the chat.";
  } catch {
    st.textContent = "Can't reach the server.";
  }
}

// ---------- rendering ----------
function md(text) {
  // Tiny, safe Markdown: escape first, then **bold**, *italic*, bullet lists, paragraphs.
  const lines = esc(text).split(/\n/);
  let html = "", inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<i>$2</i>");
    const m = line.match(/^\s*[-*•]\s+(.*)/);
    if (m) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${m[1]}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim()) html += `<p>${line}</p>`;
    }
  }
  return html + (inList ? "</ul>" : "");
}

function addMessage(role, html) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = html;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function renderWelcome() {
  addMessage("bot", `<div class="welcome"><p><b>Hi! Ask me anything about your money.</b></p>
    <p>I look up every answer in your own transactions, sort your spending into baskets, and compare it with Statistics Finland's open data. Try one of these:</p></div>`);
  $("suggestions").innerHTML = SUGGESTIONS.map((q) => `<button class="chip" type="button">${esc(q)}</button>`).join("");
  $("suggestions").querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => ask(b.textContent)));
}

const SERIES_COLORS = { you: "var(--c-you)", fi: "var(--c-ref)", v: "var(--c-you)", regular: color("regular"), irregular: color("irregular"), everyday: color("everyday"), extras: color("extras") };
const isTimeKey = (k) => /^\d{4}-\d{2}(-\d{2})?$/.test(k) || /^\d{2}$/.test(k);
const prettyKey = (k) => (/^\d{4}-\d{2}$/.test(k) ? monthName(k, "short") : /^\d{4}-\d{2}-\d{2}$/.test(k)
  ? new Date(`${k}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : /^\d{2}$/.test(k) ? `${k}:00` : k);

function renderBlock(b) {
  const wrap = document.createElement("div");
  wrap.className = "block";
  wrap.innerHTML = `<h4>${esc(b.title || "")}</h4>`;
  const visibleSeries = b.series.filter((s) => !s.table);
  if (b.kind === "table" || !b.rows.length) {
    const cols = b.series;
    wrap.insertAdjacentHTML("beforeend", `<div class="table-scroll"><table class="data"><thead><tr><th></th>${cols.map((c) => `<th class="r">${esc(c.name)}</th>`).join("")}</tr></thead>
      <tbody>${b.rows.map((r) => `<tr><td>${esc(prettyKey(r.label))}</td>${cols.map((c) => `<td class="r">${c.key === "n" ? r[c.key] : fmt(r[c.key])}</td>`).join("")}</tr>`).join("")
        || `<tr><td class="muted">No data</td></tr>`}</tbody></table></div>`);
  } else if (b.kind === "bar" && !(b.rows.length > 1 && b.rows.every((r) => isTimeKey(r.label)))) {
    // horizontal bars for categories (one or two series)
    const max = Math.max(...b.rows.flatMap((r) => visibleSeries.map((s) => r[s.key] || 0))) || 1;
    if (visibleSeries.length > 1) wrap.insertAdjacentHTML("beforeend", legend(visibleSeries));
    const grid = document.createElement("div");
    grid.className = "hbar";
    grid.innerHTML = b.rows.map((r) => `<div class="lbl" title="${esc(prettyKey(r.label))}">${esc(prettyKey(r.label))}</div>
      <div class="bars">${visibleSeries.map((s) => `<div class="bar-row"><div class="bar" style="width:${((r[s.key] || 0) / max) * 72}%;background:${SERIES_COLORS[s.key]}"></div><span class="val">${fmt(r[s.key] || 0)}</span></div>`).join("")}</div>`).join("");
    wrap.appendChild(grid);
  } else {
    if (visibleSeries.length > 1) wrap.insertAdjacentHTML("beforeend", legend(visibleSeries));
    wrap.appendChild(columnChart(b, visibleSeries));
  }
  if (b.note) wrap.insertAdjacentHTML("beforeend", `<div class="note">${esc(b.note)}</div>`);
  return wrap;
}

const legend = (series) => `<div class="legend" style="margin:0 0 8px">${series.map((s) =>
  `<span class="legend-item"><i class="swatch" style="background:${SERIES_COLORS[s.key]}"></i>${esc(s.name)}</span>`).join("")}</div>`;

// Columns (one series or stacked) or a line, over ordered keys.
function columnChart(b, series) {
  const host = document.createElement("div");
  host.className = "chart";
  requestAnimationFrame(() => {
    const W = host.clientWidth || 340, H = 170;
    const m = { t: 10, r: 6, b: 22, l: 38 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const stacked = b.kind === "stacked";
    const totals = b.rows.map((r) => (stacked ? series.reduce((a, s) => a + (r[s.key] || 0), 0) : Math.max(...series.map((s) => r[s.key] || 0))));
    const max = niceMax(Math.max(...totals, 1));
    const y = (v) => m.t + ih - (v / max) * ih;
    const band = iw / b.rows.length;
    const bw = Math.min(20, band * 0.62);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": b.title || "Chart" }, host);
    for (let i = 0; i <= 3; i++) {
      const v = (max / 3) * i;
      el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: i ? "gridline" : "baseline" }, svg);
      el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = compact(v);
    }
    const every = Math.ceil(b.rows.length / Math.max(1, Math.floor(iw / 44)));
    if (b.kind === "line") {
      const s = series[0];
      const pts = b.rows.map((r, i) => [m.l + i * band + band / 2, y(r[s.key] || 0)]);
      el("path", { d: `M${pts.map((p) => p.join(",")).join("L")}L${pts.at(-1)[0]},${y(0)}L${pts[0][0]},${y(0)}Z`, fill: SERIES_COLORS[s.key], "fill-opacity": 0.1 }, svg);
      el("path", { d: "M" + pts.map((p) => p.join(",")).join("L"), fill: "none", stroke: SERIES_COLORS[s.key], "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      const last = pts.at(-1);
      el("circle", { cx: last[0], cy: last[1], r: 4, fill: SERIES_COLORS[s.key], stroke: cssVar("--surface"), "stroke-width": 2 }, svg);
    }
    b.rows.forEach((r, i) => {
      const cx = m.l + i * band + band / 2;
      if (b.kind !== "line") {
        let base = 0;
        const parts = stacked ? series.filter((s) => r[s.key] > 0) : series.slice(0, 1);
        parts.forEach((s, j) => {
          const v = r[s.key] || 0;
          const y0 = y(base), y1 = y(base + v);
          const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
          if (h > 0) {
            if (j === parts.length - 1) el("path", { d: topRoundedRect(cx - bw / 2, y1, bw, h, 4), fill: SERIES_COLORS[s.key] }, svg);
            else el("rect", { x: cx - bw / 2, y: y1, width: bw, height: h, fill: SERIES_COLORS[s.key] }, svg);
          }
          base += v;
        });
      }
      if (i % every === 0) el("text", { x: cx, y: H - 6, "text-anchor": "middle" }, svg).textContent = prettyKey(r.label).replace(/ \d{4}$/, "");
      const hit = el("rect", { x: m.l + i * band, y: m.t, width: band, height: ih, class: "hit" }, svg);
      hover(hit, `<div class="tt-title">${esc(prettyKey(r.label))}</div>` +
        series.map((s) => ttRow(s.name, fmt(r[s.key] || 0), SERIES_COLORS[s.key], b.kind === "line")).join("") +
        (r.n != null ? ttRow("Transactions", r.n) : ""));
    });
  });
  return host;
}

// ---------- asking ----------
async function ask(question) {
  question = question.trim();
  if (!question || busy) return;
  $("suggestions").innerHTML = "";
  addMessage("user", esc(question));
  history.push({ role: "user", text: question });
  input.value = "";
  autosize();

  if (!aiReady) {
    addMessage("bot error", "The chat isn't connected yet. Add your <code>GEMINI_API_KEY</code> to the <code>.env</code> file and restart the server with <code>npm start</code>.");
    return;
  }

  busy = true;
  sendBtn.disabled = true;
  const thinking = addMessage("bot", `<div class="thinking"><i></i><i></i><i></i> Looking at your transactions…</div>`);
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, overrides: getOverrides() }),
    });
    const out = await res.json();
    thinking.remove();
    if (!res.ok) throw new Error(out.error || `Error ${res.status}`);
    const msg = addMessage("bot", md(out.text || ""));
    for (const b of out.blocks || []) msg.appendChild(renderBlock(b));
    if (out.trace?.length) {
      msg.insertAdjacentHTML("beforeend", `<details class="trace"><summary>How I worked this out (${out.trace.length} lookup${out.trace.length > 1 ? "s" : ""})</summary>${
        out.trace.map((t) => `<code>${esc(t.tool)}(${esc(JSON.stringify(t.args))})</code>`).join("")}</details>`);
    }
    for (const a of out.actions || []) if (a.type === "dashboard") applyDashboardAction(a);
    history.push({ role: "model", text: out.text || "" });
    log.scrollTop = log.scrollHeight;
  } catch (e) {
    thinking.remove();
    addMessage("bot error", `Sorry, something went wrong: ${esc(e.message)}`);
    history.pop();
  } finally {
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

function autosize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
}
input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input.value); }
});
form.addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });

renderWelcome();
checkStatus().then(() => {
  // Deep link: ?ask=How+much+did+I+spend+on+taxis
  const q = new URLSearchParams(location.search).get("ask");
  if (q) ask(q);
});
