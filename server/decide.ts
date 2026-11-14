// gemini-decision-1 picks which lookup answers the question. One call, no
// generated text. A low-confidence pick is handed back to the full coach.

import { GoogleGenAI } from "@google/genai";
import { routeFromChoices, type RouteChoice } from "./route.ts";

const DECISION_MODEL = "gemini-decision-1";
const MIN_CONFIDENCE = 0.7;

const QUESTIONS = {
  tool: {
    type: "choice" as const,
    instructions: "Which one lookup answers the new question about the user's own bank account? Use the earlier lines only to resolve words like 'that' or 'the same'.",
    criteria: {
      month_baskets: "Where the money went this month overall: income, bills, slips, nice-to-have, total spend.",
      emergency_fund: "Savings buffer, rainy day, months of expenses covered, whether they are safe if something happens.",
      budget_status: "Their own monthly budget limits versus what they have already spent.",
      check_purchase: "They want to buy, get, or afford a specific thing, and a price is part of the question.",
      seasonal_pattern: "Christmas, Black Friday, summer, which months people spend more, whether a high month is normal for the season.",
      money_mood: "How they are doing, whether they messed up, why the mentor is angry or pleased.",
      spend_series: "How much they spent on one kind of thing: taxis, food, fun, groceries, rent, and so on.",
      safe_to_spend: "What is safe to spend this week, or how much is left after upcoming bills.",
      compare_to_finland: "Compare their spending with other Finns, peers, or Statistics Finland averages.",
      what_if: "What if they saved, invested, or redirected a monthly amount, or skipped a habit.",
      none: "Not a question about their money, or it needs more than one of these lookups.",
    },
  },
  focus: {
    type: "choice" as const,
    instructions: "If they ask about one kind of spending, which kind? Otherwise pick slips.",
    criteria: {
      taxi: "Taxis and cabs.",
      restaurants: "Restaurants, dinners, and eating out, not small café snacks.",
      junk_food: "Cafés, fast food, and kiosk snacks.",
      fun: "Events, hobbies, cinema, bars, and nights out.",
      groceries: "Supermarkets and food shops.",
      transport: "Public transport, fuel, and getting around, including taxis only when they say transport in general.",
      housing: "Rent and housing.",
      utilities: "Electricity, water, phone, and other bills.",
      health: "Pharmacy, doctor, and health.",
      entertainment: "Cinema, events, and hobbies when they say entertainment.",
      lifestyle: "Clothes, shopping, and sports gear.",
      travel: "Trips, hotels, and flights.",
      home_tech: "Furniture, electronics, and home supplies.",
      slips: "Small everyday habits, or they did not name a kind of spending.",
      nice_to_have: "Bigger extras they could live without.",
    },
  },
  category: {
    type: "choice" as const,
    instructions: "If they want to buy something, which category is it? Otherwise pick Lifestyle.",
    criteria: {
      Restaurants: "Café, restaurant, takeaway, or eating out.",
      Taxi: "A taxi ride.",
      Lifestyle: "Clothes, shoes, shopping, or sports gear, or no category is clear.",
      Entertainment: "An event, hobby, game, or night out.",
      Travel: "A trip, hotel, or flight.",
      "Home & Tech": "Furniture, electronics, or something for the home.",
      Groceries: "Food from a shop.",
      Health: "Pharmacy, doctor, or health care.",
    },
  },
  source: {
    type: "choice" as const,
    instructions: "If this is a what-if about redirecting money, where does the money come from? Otherwise pick custom.",
    criteria: {
      custom: "They name an amount, or this is not a what-if.",
      dining_cut: "Cutting restaurant or eating-out spending.",
      taxi: "Redirecting what they spend on taxis.",
    },
  },
  asset: {
    type: "choice" as const,
    instructions: "If this is a what-if, where would the money go? Otherwise pick index_fund.",
    criteria: {
      index_fund: "A fund, stocks, or investing, or they don't say.",
      nokia: "Nokia shares.",
      savings: "A savings account or cash earning interest.",
    },
  },
};

let client: GoogleGenAI | null = null;

function decisions() {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: "v1beta" });
  return client;
}

function decisionInput(query: string, history: { role?: string; text?: string }[]) {
  const earlier = history
    .filter((turn) => turn && typeof turn.text === "string" && turn.text.trim())
    .slice(-4)
    .map((turn) => `${turn.role === "mentor" ? "Mikko" : "User"}: ${String(turn.text).trim().slice(0, 300)}`)
    .join("\n");
  return earlier ? `Earlier in the conversation:\n${earlier}\n\nNew question: ${query}` : query;
}

export async function decideRoute(
  query: string,
  history: { role?: string; text?: string }[],
): Promise<{ name: string; args: Record<string, unknown> } | null> {
  const started = Date.now();
  const result = await decisions().decisions.create({
    model: DECISION_MODEL,
    input: decisionInput(query, history),
    questions: QUESTIONS,
  });
  const tool = result.answers?.tool;
  if (!tool || tool.type !== "choice") return null;
  console.log(`Route ${tool.choice} (${tool.confidence.toFixed(2)}) in ${Date.now() - started}ms`);
  if (tool.confidence < MIN_CONFIDENCE) return null;
  const pick = (key: keyof RouteChoice) => {
    const answer = result.answers?.[key];
    return answer?.type === "choice" ? answer.choice : undefined;
  };
  return routeFromChoices({
    tool: tool.choice,
    focus: pick("focus"),
    category: pick("category"),
    source: pick("source"),
    asset: pick("asset"),
  }, query);
}
