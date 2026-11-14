# Personal Economic Trainer

A pixel-art money coach in a phone frame, built in the spirit of S-mobiili. Mikko looks at one customer's own transactions, sorts the month into three baskets, and answers questions in chat. Gemini writes the replies. The euros come from Postgres.

## What it does

- **Three baskets** for the latest month: mandatory and regular (rent, bills, groceries, commuting), mandatory and irregular (health, home and tech), and slips (the small habits and nice-to-haves).
- **Honesty checks.** Mikko flags a repeating lifestyle or entertainment charge, a late-night taxi or meal, or a large home-and-tech purchase. Naming it honestly earns XP and coins. Calling a middle-of-the-night taxi "rent" does not.
- **Locker.** Coins buy mentor styles, app themes, and S-Bank card skins. Level gates apply. That progress stays in the browser.
- **Ask Mikko.** Chat can cover a category or merchant type (taxis, restaurants, groceries, and the rest), what is safe to spend this week, a comparison with Statistics Finland for the customer's age, and a what-if that redirects a monthly amount into cash, an S-savings account, a global index fund, or a volatile Nokia replay.

The picker loads three demo customers already stored in Postgres: `CUST01957` and `CUST02663` (age 40) and `CUST02528` (age 21).

## Run it

Node.js 20.12 or newer.

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to the Postgres database (customers, transactions, and a `benchmarks` row) and set `GEMINI_API_KEY`.
3. Install and start:

```
npm install
npm start
```

Open http://localhost:3000.

```
npm test                 # basket, quest, and what-if checks
npm run fetch:benchmarks # refresh the Statistics Finland row in Postgres
```

`GEMINI_MODEL` defaults to `gemini-4-hydrogen`. `GEMINI_THINKING_LEVEL` defaults to `medium`.

## How the pieces fit

| Path | Role |
|---|---|
| `src/` | The phone UI: Mikko's room, baskets, dialogue, charts, locker |
| `src/game/engine.ts` | Baskets, quests, safe-to-spend, and the what-if simulation |
| `server/db.mjs` | Customers, transactions, and benchmarks from Postgres |
| `server/chat.ts` | Gemini tool loop. Tools compute the numbers; `speak` is the reply |
| `server/server.ts` | API and the Vite dev server on port 3000 |
| `scripts/fetch-benchmarks.mjs` | Household Budget Survey 2022 and the consumer price index, from Statistics Finland |

Chat uses the Gemini Interactions API with `store: false`, so the conversation is not kept on Google's side after the answer. The server sends the recent turns again on the next question. Your question and the tool summaries (totals, not the full ledger) are what get sent to the model.

Benchmark source: Statistics Finland, CC BY 4.0. Survey figures are per consumption unit per month and are lifted to recent prices with the consumer price index.
