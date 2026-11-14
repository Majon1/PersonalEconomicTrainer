# Personal Economic Trainer

A pixel-art money coach built in the spirit of S-mobiili. Mikko looks at one customer's own transactions, sorts the month into four baskets, and answers questions in chat. Gemini writes the replies. The euros come from Postgres.

## What it does

- **Four baskets** for the latest month, two you must pay and two you choose: mandatory and regular (rent, bills, groceries, commuting), mandatory and irregular (health, home and tech), slips (small habits up to €40 that slip through your fingers: coffees, quick lunches, taxis, parking) and nice to have (bigger extras you could live without if money got tight: travel, hobbies, events, shopping, dinners out). Money moved to investments counts as saving, not spending. The €40 line is `SMALL_PURCHASE_EUR` in `src/game/engine.ts`.
- **Money mood.** Mikko's face follows the month's decisions: impressed when you live within your means, suspicious when you could do better (spent more than came in, slips jumped, thin emergency fund, little left to save), and angry when a slip or nice-to-have left less than the rent and bills still due before payday, or took the account into the red. Comes with a 0-100 score, banded to the mood.
- **Emergency fund.** Progress towards keeping 3 months of money going out on the account (3 months of pay is shown as an alternative). Investments don't count; they are not instant cash.
- **Honesty checks.** Mikko flags a repeating lifestyle or entertainment charge, a late-night taxi or meal, or a large home-and-tech purchase. Naming it honestly earns XP and coins. Calling a middle-of-the-night taxi "rent" does not.
- **Budget.** Set monthly limits for slips and nice-to-haves (plus optional per-category limits); Mikko suggests your last 3 months minus 10%. The budget bar shows what is left, Mikko warns when a limit is nearly used up, and "Can I buy it?" checks a planned purchase against the budget, the money needed for bills until payday, and the emergency fund (go / think twice / skip it). Ask in chat too: "Can I buy sneakers for €90?".
- **You vs Finland.** Mikko offers to compare you with Statistics Finland figures for your age; yes opens a board of your average month per category against other Finns, price-adjusted.
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

### On a phone

The layout fills any phone screen (portrait or landscape) and shows a phone frame only on screens at least 640 × 760. It is an installable web app (manifest, icons and an offline service worker in `public/`).

- **Over Wi-Fi:** start with `HOST=0.0.0.0 npm start` (PowerShell: `$env:HOST="0.0.0.0"; npm start`) and open `http://<this computer's IP>:3000` on the phone. Anyone on that network can then use the app and its chat, so only do this on a network you trust. If it doesn't load, allow Node.js through the Windows firewall for private networks.
- **Install to the home screen** needs HTTPS, so it works once the app is deployed (`npm run build`, then `NODE_ENV=production npm start` behind HTTPS).

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
