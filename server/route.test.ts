import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewerPeriod } from "../scripts/fetch-benchmarks.mjs";
import { eurosInText, lineFor, monthsInText, routeFromChoices, scriptedCall } from "./route.ts";

test("a euro amount is read from the question, and a bare number is not", () => {
  assert.equal(eurosInText("Can I buy sneakers for €80?"), 80);
  assert.equal(eurosInText("what about 12,50 euros"), 12.5);
  assert.equal(eurosInText("a 50e taxi"), 50);
  assert.equal(eurosInText("50 each would be a lot"), null);
  assert.equal(eurosInText("how much on taxis"), null);
});

test("a horizon in months or years is read from the question", () => {
  assert.equal(monthsInText("save €20 for 2 years"), 24);
  assert.equal(monthsInText("over 18 months"), 18);
  assert.equal(monthsInText("what if I invested it"), null);
});

test("the topic buttons map to a lookup and everyone else does not", () => {
  assert.deepEqual(scriptedCall("  How much did I spend on taxis last month? "), {
    name: "spend_series",
    args: { focus: "taxi" },
  });
  assert.equal(scriptedCall("How much did I spend on taxis in March?"), null);
});

test("a purchase or a custom what-if without a price is left for the full coach", () => {
  assert.equal(routeFromChoices({ tool: "check_purchase", category: "Lifestyle" }, "can I buy new sneakers"), null);
  assert.equal(routeFromChoices({ tool: "what_if", source: "custom", asset: "nokia" }, "what if I bought Nokia"), null);
  assert.deepEqual(
    routeFromChoices({ tool: "check_purchase", category: "Lifestyle" }, "can I buy sneakers for €80"),
    { name: "check_purchase", args: { amount: 80, category: "Lifestyle", what: "can I buy sneakers for €80" } },
  );
  assert.equal(routeFromChoices({ tool: "what_if", source: "taxi", asset: "savings" }, "what if I invested the taxis")?.name, "what_if");
});

test("a figured sentence only uses numbers the tool returned", () => {
  const line = lineFor("spend_series", { focus: "taxi", month: "2026-09", latest_total: 42.5, latest_count: 3 });
  assert.match(line, /Taxi in 2026-09: €42\.50 across 3/);
});

test("a month with €0 on fun gets a jab, a €0 bill does not", () => {
  assert.equal(
    lineFor("spend_series", { focus: "fun", month: "2026-09", latest_total: 0, latest_count: 0 }),
    "Fun in 2026-09: €0. You must be fun at parties.",
  );
  assert.equal(
    lineFor("spend_series", { focus: "housing", month: "2026-09", latest_total: 0, latest_count: 0 }),
    "Housing in 2026-09: €0.",
  );
});

test("a published period is newer only when it is later than the stored one", () => {
  assert.equal(isNewerPeriod("2026-10", "2026-09"), true);
  assert.equal(isNewerPeriod("2026-10", "2026-10"), false);
  assert.equal(isNewerPeriod("2026-10", null), true);
  assert.equal(isNewerPeriod(null, "2026-10"), false);
  assert.equal(isNewerPeriod("2026", "2022"), true);
});