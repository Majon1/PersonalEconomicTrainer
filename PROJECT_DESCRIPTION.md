Try it: https://grossly-powerful-buck.eur-1.aiven.app/

## S-Pankki challenge

S-Pankki asked for an AI coach that lets people talk with their own banking data. Mikko answers in plain words, from "How much did I spend on taxis?" to "What is safe to spend this week?" or "Can I buy sneakers for €90?". You ask what you want instead of reading charts the bank picked.

- He sorts each month into four baskets: bills you must pay, surprise costs like a dentist visit, small habits like coffees that slip through your fingers, and nice extras you could live without.
- He compares you with the average Finn your age, using Statistics Finland data adjusted for today's prices.
- He asks about unclear payments ("€48.84 to Events, what was it?") and remembers your answer, so he never asks twice.
- What if you put €100 a month into an index fund? He replays it on real past prices and shows the result in a chart.
- He helps you set a budget, tracks your rainy day fund in months of costs, and warns you before December, when Finns spend about 14% more.

Honest answers earn points and coins that buy pixel cards and app themes. Mikko's face shows how your month is going: impressed when you live within your means, suspicious when you could do better. The app fits on one phone screen, from small Androids to the iPhone 16 Pro Max, and is ready to embed in S-mobiili.

## Aiven

The app runs as a container on Aiven's application platform in Frankfurt, connected to a managed Aiven PostgreSQL database over verified TLS. Postgres holds the transaction ledger, the cached Statistics Finland benchmarks, and Mikko's persistent memory, budget history and XP, so progress follows you across devices. The benchmarks are checked against Statistics Finland at most once a day, so no question waits on an outside API.

## Gemini

Questions run through a two stage pipeline. `gemini-decision-1` classifies the intent and picks the right financial lookup, our deterministic engine computes the exact euros, and `gemini-3.5-flash-lite` turns them into Mikko's short reply. Unclear questions escalate to `gemini-4-hydrogen` with a full tool calling loop. The model never invents numbers. Only totals are sent, never the full ledger, and with `store: false` Google does not keep the conversation.

## Technologies used

- **React 19 and TypeScript:** the phone interface, Mikko's pixel room and the charts.
- **Vite:** builds the app and reloads it instantly during development.
- **Tailwind CSS 4:** styling that adapts the layout to every phone size.
- **Node.js and Express:** the server that answers chat questions and reads and saves data.
- **Aiven PostgreSQL:** stores transactions, Statistics Finland figures, and Mikko's memory, budgets and XP.
- **Aiven application hosting (Docker):** runs the live app in Frankfurt.
- **Gemini API (`@google/genai`):** understands each question and writes Mikko's replies.
- **Statistics Finland open data:** the household spending survey and consumer price index behind the "you vs Finland" comparison.
- **Lucide icons:** the icons in the menus and navigation bar.
