# PersonalEconomicTrainer

Chat with your own money: a personal finance trainer built on synthetic
S-Bank-style transaction data, in the spirit of MyData.

- **Ask anything** in the chat ("How much did I spend on taxis last month?",
  "What kind of spender am I?", "What is safe for me to spend this week?",
  "How much could I save if I reduced dining out by 20%?"). Gemini answers by
  calling tools that compute every number from your own transactions, and can
  draw charts in the chat or point the dashboard at the right month.
- **The baskets** frame every answer: mandatory & regular, mandatory &
  irregular, everyday spending that slips through your fingers, and nice-to-haves
  you could live without if money got tight. "Where it really goes" shows the
  small habits behind the third basket and what they cost per year.
- **Your data, your rules:** move any category or merchant type to another
  basket, see exactly what the data contains, and download it as JSON or CSV.
- **Open-data benchmarks** from Statistics Finland: spending per category vs.
  people your age (Household Budget Survey 2022), price-adjusted with the
  consumer price index.

## Run it

Requires Node.js 20.12 or newer. There are no npm dependencies.

1. Put the CSV files in `data/` (the large `tx_junction_transactions.csv` is not in git).
2. Copy `.env.example` to `.env` and add your Gemini API key.
3. Start the server and open http://localhost:3000:
   ```
   npm start
   ```

The dashboard works without a key; the chat needs one.

### Data scripts

```
npm run build:customer -- CUST01957   # extract one customer to web/data/customer.json
npm run fetch:benchmarks              # refresh data/benchmarks.json from Statistics Finland
```

## How it fits together

| Path | What it does |
|---|---|
| `scripts/build-customer.mjs` | Reads the CSVs, sorts each transaction into a basket |
| `scripts/fetch-benchmarks.mjs` | Downloads benchmark tables from the Statistics Finland PxWeb API |
| `web/finance.js` | Shared calculation engine (dashboard and chat use the same numbers) |
| `web/app.js`, `web/chat.js` | Dashboard and chat panel |
| `server/server.mjs` | Serves the app, runs the Gemini tool-calling loop |
| `server/tools.mjs` | Tool definitions: query, profile, safe-to-spend, what-if, benchmark, charts, dashboard control |

## The baskets

Two baskets you must pay, two you choose:

| Basket | What goes in it by default |
|---|---|
| Mandatory & regular | Housing, utilities, groceries, commuting and fuel |
| Mandatory & irregular | Health, home & tech (repairs, appliances, furniture) |
| Slips through your fingers | Small habitual purchases up to 40 €: cafés, quick lunches, bars, kiosk snacks, taxis, parking |
| Nice to have | Things you could live without if money got tight: travel, hobbies, events, shopping, meals out and taxis over 40 € |

The first three are the brief's baskets; *Nice to have* keeps big deliberate
purchases from hiding the small leaks. The 40 € limit is `SMALL_PURCHASE_EUR` in
`scripts/build-customer.mjs`. Users can change any rule in the **My data** section.

## Privacy

When you use the chat, your question and the summaries the model asks for
(totals, averages, a few example transactions) are sent to Google Gemini. The
full transaction list stays on the local server.

The chat uses the Gemini Interactions API with `store: false`, so Google does
not keep the conversation after answering (by default it would store it for
1–55 days). The server resends the conversation on each turn instead. Model:
`gemini-4-hydrogen` with `thinking_level: medium`; both can be changed in `.env`.

Benchmark data: Statistics Finland, CC BY 4.0.
