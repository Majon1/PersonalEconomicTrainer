// Pure routing helpers. The decision model picks a tool; these turn that
// choice into arguments, and turn a tool result into a sentence when no
// model reply is needed (the topic buttons, or a reply that failed).

const TOOLS = new Set([
  "month_baskets", "emergency_fund", "budget_status", "check_purchase", "seasonal_pattern",
  "money_mood", "spend_series", "safe_to_spend", "compare_to_finland", "what_if", "none",
]);

const FOCI = new Set([
  "taxi", "restaurants", "junk_food", "fun", "groceries", "transport", "housing", "utilities",
  "health", "entertainment", "lifestyle", "travel", "home_tech", "slips", "nice_to_have",
]);

const CATEGORIES = new Set([
  "Restaurants", "Taxi", "Lifestyle", "Entertainment", "Travel", "Home & Tech", "Groceries", "Health",
]);

const SOURCES = new Set(["custom", "dining_cut", "taxi"]);
const ASSETS = new Set(["index_fund", "nokia", "savings"]);

/** The topic-button questions, answered from the engine with no model call. */
const SCRIPTED: Record<string, { name: string; args: Record<string, unknown> }> = {
  "how am i doing this month? why are you in that mood?": { name: "money_mood", args: {} },
  "what is safe for me to spend this week?": { name: "safe_to_spend", args: {} },
  "do i have enough of an emergency fund?": { name: "emergency_fund", args: {} },
  "how much did i spend on taxis last month?": { name: "spend_series", args: { focus: "taxi" } },
  "how much did i spend on junk food this month (cafés, fast food, kiosk snacks)?": { name: "spend_series", args: { focus: "junk_food" } },
  "how much did i spend on fun this month (events, hobbies, nights out)?": { name: "spend_series", args: { focus: "fun" } },
};

export function normaliseQuestion(query: string) {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function scriptedCall(query: string) {
  return SCRIPTED[normaliseQuestion(query)] ?? null;
}

/** First euro amount written in the question, or null. */
export function eurosInText(text: string): number | null {
  const match = text.match(/€\s*(\d{1,6}(?:[.,]\d{1,2})?)|(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:€|euros?)\b|(\d{1,6}(?:[.,]\d{1,2})?)e\b/i);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function monthsInText(text: string): number | null {
  const years = text.match(/(\d{1,2})\s*years?\b/i);
  if (years) return Math.min(120, Number(years[1]) * 12);
  const months = text.match(/(\d{1,3})\s*months?\b/i);
  if (months) return Math.min(120, Number(months[1]));
  return null;
}

export interface RouteChoice {
  tool: string;
  focus?: string;
  category?: string;
  source?: string;
  asset?: string;
}

/**
 * Arguments for the chosen tool. Null when a price is required and the
 * question doesn't state one: the full coach then reads the amount itself.
 */
export function routeFromChoices(choice: RouteChoice, query: string): { name: string; args: Record<string, unknown> } | null {
  if (!TOOLS.has(choice.tool)) return null;
  if (choice.tool === "none") return { name: "none", args: {} };
  if (choice.tool === "spend_series") {
    return { name: choice.tool, args: { focus: FOCI.has(choice.focus ?? "") ? choice.focus : "slips" } };
  }
  if (choice.tool === "check_purchase") {
    const amount = eurosInText(query);
    if (amount == null) return null;
    return {
      name: choice.tool,
      args: {
        amount,
        category: CATEGORIES.has(choice.category ?? "") ? choice.category : "Lifestyle",
        what: query.trim().slice(0, 80),
      },
    };
  }
  if (choice.tool === "what_if") {
    const source = SOURCES.has(choice.source ?? "") ? choice.source! : "custom";
    const monthly = eurosInText(query);
    if (source === "custom" && monthly == null) return null;
    const months = monthsInText(query);
    return {
      name: choice.tool,
      args: {
        source,
        asset: ASSETS.has(choice.asset ?? "") ? choice.asset : "index_fund",
        ...(monthly != null ? { monthly_amount: monthly } : {}),
        ...(months != null ? { months } : {}),
      },
    };
  }
  return { name: choice.tool, args: {} };
}

function eur(n: unknown) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "€0";
  const rounded = Math.round(v * 100) / 100;
  return Number.isInteger(rounded) ? `€${rounded}` : `€${rounded.toFixed(2)}`;
}

function capitalise(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** A dry jab when a treat month is exactly €0. Bills and health get none. */
const ZERO_JAB: Record<string, string> = {
  fun: "You must be fun at parties.",
  entertainment: "The sofa sends its regards.",
  junk_food: "The kiosk has forgotten your name.",
  restaurants: "Dining in. Or not dining at all.",
  taxi: "The tram appreciates your loyalty.",
};

export function zeroJab(focus: unknown, total: unknown) {
  if (Number(total) !== 0) return "";
  return ZERO_JAB[String(focus)] ?? "";
}

/** A sentence built only from the tool result, so it can't invent a figure. */
export function lineFor(name: string, result: any): string {
  if (!result || result.error) return "I can't see that figure from here.";
  switch (name) {
    case "month_baskets":
      return `In ${result.month} you took in ${eur(result.income)} and spent ${eur(result.total_spend)}. Slips ${eur(result.slips)}, nice to have ${eur(result.nice_to_have)}, regular bills ${eur(result.mandatory_regular)}.`;
    case "emergency_fund":
      return result.status === "reached"
        ? `Emergency fund: ${eur(result.balance)} covers ${Number(result.monthsCovered).toFixed(1)} months. The ${result.goalMonths}-month goal is reached.`
        : `Emergency fund: ${eur(result.balance)} covers ${Number(result.monthsCovered).toFixed(1)} months. ${result.goalMonths} months would be ${eur(result.target)}, so ${eur(result.missing)} to go.`;
    case "budget_status": {
      if (!result.has_budget) {
        const s = result.suggestion ?? {};
        return `No budget set yet. From your spending, slips ${eur(s.slips)} and nice to have ${eur(s.nice_to_have)} a month would be a start.`;
      }
      if (!result.worst) return `Budget for ${result.month} is inside the limits.`;
      return `${result.worst.label} is ${result.worst.status}: ${eur(result.worst.spent)} of ${eur(result.worst.limit)}.`;
    }
    case "check_purchase":
      return String(result.text || "I checked the purchase.");
    case "seasonal_pattern": {
      const ahead = result.coming_up?.title ? ` Coming up: ${result.coming_up.title}.` : "";
      return `Your busiest month is ${result.your_busiest_month}; Finland's is ${result.finland_busiest_month}.${ahead}`;
    }
    case "money_mood": {
      const label = result.mood === "happy" ? "Doing well" : result.mood === "mild" ? "Could be better" : "Rent at risk";
      const bits = [...(result.reasons?.bad ?? []), ...(result.reasons?.meh ?? []), ...(result.reasons?.good ?? [])]
        .slice(0, 3)
        .map((s: string) => capitalise(String(s)));
      return `${label} (${result.score}/100) in ${result.month}. ${bits.join(". ")}.`;
    }
    case "spend_series": {
      const label = capitalise(String(result.focus ?? "spending").replaceAll("_", " "));
      const count = Number(result.latest_count) || 0;
      const spent = count > 0 ? `${eur(result.latest_total)} across ${count}` : eur(result.latest_total);
      const jab = zeroJab(result.focus, result.latest_total);
      return `${label} in ${result.month}: ${spent}.${jab ? ` ${jab}` : ""}`;
    }
    case "safe_to_spend":
      return `Safe to spend this week: ${eur(result.safeWeekly)}. ${eur(result.reservedRegular)} stays for regular bills and ${eur(result.surpriseBuffer)} for a surprise.`;
    case "compare_to_finland": {
      const diff = Number(result.your_total_per_month) - Number(result.finland_total_per_month);
      const top = [...(result.rows ?? [])].sort((a, b) => (b.yours - b.finland) - (a.yours - a.finland))[0];
      const gap = top ? ` Biggest gap: ${top.category}.` : "";
      return `You spend ${eur(Math.abs(diff))} a month ${diff > 0 ? "more" : "less"} than other Finns aged ${result.age_group}.${gap}`;
    }
    case "what_if":
      return `${result.source}: ${eur(result.monthly_amount)} a month in ${result.asset} for ${result.months} months comes to ${eur(result.final_asset_value)} (cash would be ${eur(result.cash_if_uninvested)}).`;
    default:
      return "The numbers are on the chart.";
  }
}
