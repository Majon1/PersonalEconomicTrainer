import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, SEED_TRANSACTIONS, SHOP_CATALOG } from './data';
import {
  answerFinanceQuery,
  checkPurchase,
  christmasQuarterGap,
  computeBaskets,
  computeBudgetStatus,
  computeEmergencyFund,
  computeSeasonCompare,
  seasonalFactor,
  seasonalHeadsUp,
  suggestBudget,
  computeMoneyMood,
  computeSafeToSpend,
  detectRiskyPurchases,
  detectSuspicionQuests,
  levelFromXp,
  activeBudget,
  memoryFromQuest,
  mergeBudgets,
  mergeMemory,
  saveBudgetVersion,
  sanitizeProgress,
  sanitizeSavedBudget,
  rememberQuest,
  sanitizeMemoryEntry,
  withMemoryOverrides,
  purchaseOrEquipItem,
  resolveInterrogationChoice,
  simulateWhatIf,
} from './engine';
import type { LabelOverride, PlayerProgress, Transaction } from './types';

test('computeBaskets totals and live label override shifts euros across baskets', () => {
  const mikkoTxs = SEED_TRANSACTIONS.filter(
    (t) => t.customerId === 'mikko' && t.source === 'sbank',
  );
  const before = computeBaskets(mikkoTxs, [], '2026-09');
  assert.equal(before.mandatory_regular, 1251);
  assert.equal(before.mandatory_irregular, 404);
  // Small taxis and fast food (<= €40) slip; bigger meals, rides and the subscription are nice-to-haves.
  assert.equal(before.slips, 118.7);
  assert.equal(before.nice_to_have, 235.29);

  // Override MRC-LIF-0042 (€14.99) from Nice to have -> Mandatory & Regular
  const overrides: LabelOverride[] = [
    {
      merchantId: 'MRC-LIF-0042',
      customLabel: 'Streaming',
      basket: 'mandatory_regular',
    },
  ];
  const after = computeBaskets(mikkoTxs, overrides, '2026-09');
  assert.equal(after.mandatory_regular, 1265.99);
  assert.equal(after.nice_to_have, 220.3);
  assert.equal(after.slips, 118.7);
  assert.equal(after.totalSpend, before.totalSpend);
});

// Small hand-made ledger: salary on the 1st, rent due on the 5th.
function tx(id: string, date: string, category: string, amount: number, balanceAfter: number, extra: Partial<Transaction> = {}): Transaction {
  return { id, customerId: 't', date, time: '12:00:00', category, amount, balanceAfter, merchantId: `M-${id}`, mcc: '', source: 'sbank', ...extra };
}

test('investments are saving, not spending', () => {
  const ledger = [
    tx('1', '2026-09-01', 'Salary', 2000, 2500, { type: 'salary' }),
    tx('2', '2026-09-02', 'Invest Deposit', -500, 2000, { type: 'investment_deposit' }),
    tx('3', '2026-09-03', 'Restaurants', -15, 1985, { mcc: '5814' }),
  ];
  const b = computeBaskets(ledger, [], '2026-09');
  assert.equal(b.saved, 500);
  assert.equal(b.totalSpend, 15);
  assert.equal(b.slips, 15);
});

test('takeaway that leaves less than the rent still due makes the mood angry', () => {
  const ledger = [
    tx('1', '2026-09-01', 'Salary', 1500, 1600, { type: 'salary' }),
    tx('2', '2026-09-02', 'Restaurants', -25, 700, { mcc: '5814' }), // only €700 left...
    tx('3', '2026-09-05', 'Housing', -900, -200, { type: 'housing_payment' }), // ...but €900 rent is due
    tx('4', '2026-09-30', 'Salary', 1500, 1300, { type: 'salary' }),
  ];
  const risky = detectRiskyPurchases(ledger);
  assert.equal(risky.length, 1);
  assert.equal(risky[0].billsDueBeforeIncome, 900);
  const mood = computeMoneyMood(ledger, [], '2026-09');
  assert.equal(mood.level, 'angry');
  assert.equal(mood.mentorMood, 'bluff_caught');
  assert.ok(mood.score <= 35);
  assert.match(mood.reasons.bad[0], /rent and bills still due/);
});

test('emergency fund: 3 months of money going out reached makes Mikko impressed', () => {
  const ledger = [
    tx('1', '2026-09-01', 'Salary', 3000, 9000, { type: 'salary' }),
    tx('2', '2026-09-05', 'Housing', -900, 8100, { type: 'housing_payment' }),
    tx('3', '2026-09-10', 'Groceries', -300, 7800, { mcc: '5411' }),
    tx('4', '2026-09-12', 'Restaurants', -20, 7780, { mcc: '5812' }),
  ];
  const ef = computeEmergencyFund(ledger, [], '2026-09');
  assert.equal(ef.monthlyOutgoings, 1220);
  assert.equal(ef.target, 3660);
  assert.equal(ef.status, 'reached');
  const mood = computeMoneyMood(ledger, [], '2026-09');
  assert.equal(mood.level, 'happy');
  assert.equal(mood.mentorMood, 'impressed');
  assert.ok(mood.score >= 70);
});

test('budget status flags a basket that is used up, and the purchase check says stop', () => {
  const ledger = [
    tx('1', '2026-09-01', 'Salary', 2500, 6000, { type: 'salary' }),
    tx('2', '2026-09-03', 'Housing', -900, 5100, { type: 'housing_payment' }),
    tx('3', '2026-09-10', 'Entertainment', -90, 5010, { mcc: '7922' }),
    tx('4', '2026-09-20', 'Lifestyle', -80, 4930, { mcc: '5651' }),
  ];
  const budget = { slips: 100, nice_to_have: 150, categories: {} };
  const status = computeBudgetStatus(ledger, [], budget, '2026-09');
  const nice = status.lines.find((l) => l.key === 'nice_to_have')!;
  assert.equal(nice.spent, 170);
  assert.equal(nice.status, 'over');
  assert.equal(status.worst?.key, 'nice_to_have');

  const verdict = checkPurchase({ transactions: ledger, overrides: [], budget, amount: 60, category: 'Lifestyle', what: 'a jacket' });
  assert.equal(verdict.verdict, 'stop');
  assert.equal(verdict.mood, 'bluff_caught');
  assert.match(verdict.text, /already used up/);

  const coffee = checkPurchase({ transactions: ledger, overrides: [], budget, amount: 4, category: 'Restaurants', what: 'a coffee' });
  assert.equal(coffee.verdict, 'go');
  assert.equal(coffee.basket, 'slips');

  const rent = checkPurchase({ transactions: ledger, overrides: [], budget, amount: 900, category: 'Housing' });
  assert.equal(rent.verdict, 'go');
  assert.equal(rent.basket, 'mandatory_regular');
});

test("Mikko's budget suggestion trims the recent average", () => {
  const ledger = [
    tx('1', '2026-07-05', 'Restaurants', -30, 1000, { mcc: '5814' }),
    tx('2', '2026-08-05', 'Restaurants', -30, 1000, { mcc: '5814' }),
    tx('3', '2026-09-05', 'Restaurants', -30, 1000, { mcc: '5814' }),
    tx('4', '2026-10-05', 'Restaurants', -300, 1000, { mcc: '5814' }),
  ];
  // Jul-Sep average €30 slips -> 90% = €27 -> rounded down to €20
  assert.equal(suggestBudget(ledger).slips, 20);
});

test('seasons: Mikko warns about Black Friday from September and Christmas from October', () => {
  assert.equal(seasonalFactor('2026-12'), 1.14);
  const sep = seasonalHeadsUp('2026-09');
  assert.equal(sep?.key, 'electronics');
  assert.equal(sep?.month, '2026-11');
  assert.match(sep!.title, /Black Friday/);
  const oct = seasonalHeadsUp('2026-10');
  assert.equal(oct?.key, 'retail');
  assert.match(oct!.title, /Christmas/);
  assert.match(oct!.text, /14% more/);
  // ...and in euros, from the quarterly national accounts: €2,083 vs €1,922 a month
  assert.equal(christmasQuarterGap(), 160);
  assert.match(oct!.text, /about €160 a month more than in January–March/);
});

// Three ordinary months, then a fourth: €1,000 out and €1,100 in each month before.
function seasonLedger(lastMonth: string, lastSpend: number, lastIncome: number) {
  const months = ['2026-08', '2026-09', '2026-10', lastMonth];
  return months.flatMap((m, i) => [
    tx(`in${i}`, `${m}-01`, 'Salary', i === 3 ? lastIncome : 1100, 10000, { type: 'salary' }),
    tx(`out${i}`, `${m}-10`, 'Groceries', -(i === 3 ? lastSpend : 1000), 10000, { mcc: '5411' }),
  ]);
}

test('a small Christmas overspend is within the normal seasonal rise, not held against you', () => {
  // December: €1,100 out, €1,050 in = €50 over. Normal December rise is 14% of ~€1,000 = €140.
  const mood = computeMoneyMood(seasonLedger('2026-12', 1100, 1050), [], '2026-12');
  assert.ok(!mood.reasons.meh.some((r) => r.includes('more than came in')));
  assert.match(mood.season ?? '', /December is a busy month/);
});

test('the same overspend in an ordinary month is a mild nudge', () => {
  // November isn't a busy month for shops overall (101), so €50 over counts.
  const mood = computeMoneyMood(seasonLedger('2026-11', 1100, 1050), [], '2026-11');
  assert.ok(mood.reasons.meh.some((r) => r.includes('more than came in')));
  assert.equal(mood.season, undefined);
});

test('season chart: your year next to Finland, with December as Finland\'s peak', () => {
  const chart = computeSeasonCompare(seasonLedger('2026-12', 1400, 1100));
  assert.equal(chart.months.length, 12);
  assert.equal(chart.months[11].finland, 114);
  assert.equal(chart.months[0].yours, null); // no January in this ledger
  assert.match(chart.yourPeak, /December/);
  assert.match(chart.finlandPeak, /December \(\+14%\)/);
  // euros per month by quarter: yours from the ledger, the average Finn's from Statistics Finland
  assert.deepEqual(chart.quarters.map((q) => q.yours), [null, null, 1000, 1200]); // Q3: Aug+Sep, Q4: Oct €1,000 + Dec €1,400
  assert.deepEqual(chart.quarters.map((q) => q.finland), [1922, 2027, 2031, 2083]);
});

test('spending more than came in with a thin buffer is a mild nudge', () => {
  const ledger = [
    tx('1', '2026-09-01', 'Salary', 1000, 1300, { type: 'salary' }),
    tx('2', '2026-09-03', 'Housing', -700, 600, { type: 'housing_payment' }),
    tx('3', '2026-09-20', 'Travel', -400, 200, { mcc: '4511' }),
  ];
  const mood = computeMoneyMood(ledger, [], '2026-09');
  assert.equal(mood.level, 'mild');
  assert.equal(mood.mentorMood, 'suspicious');
  assert.ok(mood.reasons.meh.some((r) => r.includes('more than came in')));
  assert.ok(mood.reasons.meh.some((r) => r.includes('emergency fund')));
});

test('bluff detection catches claiming a 2 AM taxi as mandatory regular bill', () => {
  const mikkoTxs = SEED_TRANSACTIONS.filter(
    (t) => t.customerId === 'mikko' && t.source === 'sbank',
  );
  const quests = detectSuspicionQuests(mikkoTxs, [], [], false);
  const nightQuest = quests.find((q) => q.reason === 'late_night_slip');
  assert.ok(nightQuest, 'Expected a late night suspicion quest');

  const lateTx = mikkoTxs.find((t) => t.id === nightQuest.txId)!;

  const bluffResult = resolveInterrogationChoice({
    quest: nightQuest,
    tx: lateTx,
    choiceId: 'claim_regular',
  });
  assert.equal(bluffResult.accepted, false);
  assert.equal(bluffResult.bluffCaught, true);
  assert.equal(bluffResult.xpEarned, 0);

  const honestResult = resolveInterrogationChoice({
    quest: nightQuest,
    tx: lateTx,
    choiceId: 'honest_slip',
  });
  assert.equal(honestResult.accepted, true);
  assert.equal(honestResult.bluffCaught, false);
  assert.equal(honestResult.xpEarned, 30);
  assert.ok(honestResult.coinsEarned > 0);
});

test('Mikko never asks about the same expense twice, whether it was answered or skipped', () => {
  const mikkoTxs = SEED_TRANSACTIONS.filter(
    (t) => t.customerId === 'mikko' && t.source === 'sbank',
  );
  const quests = detectSuspicionQuests(mikkoTxs, [], [], false);
  assert.ok(quests.length >= 2, 'Expected at least two quests in the seed ledger');
  const [first, second] = quests;
  const txOf = (id: string) => mikkoTxs.find((t) => t.id === id)!;

  // Answered: stored with the answer and what it was filed as.
  const answered = memoryFromQuest({ quest: first, tx: txOf(first.txId), outcome: 'answered', choiceId: first.choices[0].id, at: '2026-11-14T12:00:00Z' });
  assert.equal(answered.answer, first.choices[0].label);
  assert.equal(answered.basket, first.choices[0].basket);

  // Skipped: stored without an answer.
  const skipped = memoryFromQuest({ quest: second, tx: txOf(second.txId), outcome: 'skipped' });
  assert.equal(skipped.answer, undefined);

  let memory = rememberQuest([], answered);
  memory = rememberQuest(memory, skipped);
  memory = rememberQuest(memory, answered);
  assert.equal(memory.length, 2, 'The same quest is stored once');

  const after = detectSuspicionQuests(mikkoTxs, [], [], false, memory);
  assert.ok(!after.some((q) => q.id === first.id), 'Answered quest is not asked again');
  assert.ok(!after.some((q) => q.id === second.id), 'Skipped quest is not asked again');

  // On another device only the stored memory exists: the answer still files the expense.
  const overrides = withMemoryOverrides([], memory);
  assert.equal(overrides.length, 1, 'Only the answered quest becomes a label');
  assert.equal(overrides[0].basket, first.choices[0].basket);
  assert.equal(withMemoryOverrides(overrides, memory).length, 1, 'Labels are not added twice');
});

test('memory from two places merges by quest, newest wins, and junk is rejected', () => {
  const base = { reason: 'late_night_slip', txId: 't1', merchantId: 'm1', merchant: 'Taxi', amount: 24.5, date: '2026-09-12' } as const;
  const old = { ...base, questId: 'q1', outcome: 'skipped', at: '2026-11-01T10:00:00.000Z' } as const;
  const newer = { ...base, questId: 'q1', outcome: 'answered', answer: 'Night out — slipped', customLabel: 'Late-Night Taxi', basket: 'slips', at: '2026-11-02T10:00:00.000Z' } as const;
  const other = { ...base, questId: 'q2', outcome: 'skipped', at: '2026-11-01T09:00:00.000Z' } as const;
  const merged = mergeMemory([newer, other], [old]);
  assert.deepEqual(merged.map((m) => [m.questId, m.outcome]), [['q2', 'skipped'], ['q1', 'answered']]);

  assert.deepEqual(sanitizeMemoryEntry(newer), newer);
  assert.equal(sanitizeMemoryEntry({ ...newer, outcome: 'maybe' }), null);
  assert.equal(sanitizeMemoryEntry({ ...newer, at: 'yesterday' }), null);
  assert.equal(sanitizeMemoryEntry({ ...old, basket: 'slips' })?.basket, undefined, 'A skip carries no basket');
});

test('stored progress: level follows XP, only real unlocked items can be equipped', () => {
  const p = sanitizeProgress({
    xp: 455.4,
    level: 99,
    coins: -5,
    streakWeeks: 2,
    unlockedItems: ['style_detective_coat', 'not_an_item', 7],
    equippedStyle: 'detective_coat',
    equippedTheme: 'midnight',
    equippedCardSkin: 'classic_green',
  })!;
  assert.equal(p.xp, 455);
  assert.equal(p.level, 4);
  assert.equal(p.coins, 0);
  assert.equal(p.equippedStyle, 'detective_coat');
  assert.equal(p.equippedTheme, 'spankki', 'midnight is not unlocked, so the free theme is used');
  assert.ok(!p.unlockedItems.includes('not_an_item'));
  assert.ok(p.unlockedItems.includes('style_classic_visor'), 'free starter items are always kept');
  assert.equal(sanitizeProgress({ xp: 'lots', coins: 1 }), null);
});

test('every budget is kept: a new one ends the last, removing ends it, merges keep the first end', () => {
  const b1 = { slips: 120, nice_to_have: 200, categories: {} };
  const b2 = { slips: 100, nice_to_have: 180, categories: { Restaurants: 60 } };
  let list = saveBudgetVersion([], b1, '2026-11-01T10:00:00.000Z', 'b1');
  assert.equal(activeBudget(list)?.id, 'b1');

  list = saveBudgetVersion(list, b2, '2026-11-05T10:00:00.000Z', 'b2');
  assert.equal(list.length, 2, 'The old budget stays listed');
  assert.equal(list[0].endedAt, '2026-11-05T10:00:00.000Z');
  assert.equal(activeBudget(list)?.id, 'b2');

  const removed = saveBudgetVersion(list, null, '2026-11-09T10:00:00.000Z', 'unused');
  assert.equal(removed.length, 2);
  assert.equal(activeBudget(removed), null, 'Removing leaves no active budget');

  // One device still thinks b2 is active, the other ended it: ended wins.
  const merged = mergeBudgets(list, removed);
  assert.equal(merged.length, 2);
  assert.equal(activeBudget(merged), null);
  assert.equal(merged[0].endedAt, '2026-11-05T10:00:00.000Z');

  assert.deepEqual(sanitizeSavedBudget(list[1]), list[1]);
  assert.equal(sanitizeSavedBudget({ ...list[1], id: 'no spaces allowed' }), null);
  assert.equal(sanitizeSavedBudget({ ...list[1], budget: { slips: 0, nice_to_have: 0 } }), null, 'An empty budget is not a budget');
  assert.equal(sanitizeSavedBudget({ ...list[1], budget: { slips: -5, nice_to_have: 1e9 } })?.budget.nice_to_have, 100000);
});

test('XP progression levels Mikko from Lvl 2 (280 XP) to Lvl 3 on +30 XP confession', () => {
  assert.equal(levelFromXp(280), 2);
  assert.equal(levelFromXp(280 + 30), 3);
});

test('purchaseOrEquipItem enforces level gates and deducts coins once', () => {
  const progress: PlayerProgress = {
    xp: 310,
    level: 3,
    coins: 65,
    streakWeeks: 0,
    unlockedItems: ['style_classic_visor', 'theme_spankki', 'card_classic_green'],
    equippedStyle: 'classic_visor',
    equippedTheme: 'spankki',
    equippedCardSkin: 'classic_green',
  };

  const holoCard = SHOP_CATALOG.find((i) => i.id === 'card_holo_prism')!;
  const lockedRes = purchaseOrEquipItem(progress, holoCard);
  assert.equal(lockedRes.ok, false);
  assert.equal(lockedRes.action, 'locked');

  const detective = SHOP_CATALOG.find((i) => i.id === 'style_detective_coat')!;
  const buyRes = purchaseOrEquipItem(progress, detective);
  assert.equal(buyRes.ok, true);
  assert.equal(buyRes.action, 'bought_and_equipped');
  assert.equal(buyRes.next.coins, 25);
  assert.equal(buyRes.next.equippedStyle, 'detective_coat');

  // Re-equipping owned item costs 0
  const reEquip = purchaseOrEquipItem(buyRes.next, detective);
  assert.equal(reEquip.ok, true);
  assert.equal(reEquip.action, 'equipped');
  assert.equal(reEquip.next.coins, 25);
});

test('simulateWhatIf compounds index fund above cash and shows volatile Nokia curve', () => {
  const indexRes = simulateWhatIf({
    monthlyAmount: 15,
    months: 36,
    asset: 'index_fund',
  });
  assert.equal(indexRes.totalCash, 540);
  assert.ok(indexRes.finalAssetValue > indexRes.totalCash);

  const nokiaRes = simulateWhatIf({
    monthlyAmount: 15,
    months: 36,
    asset: 'nokia',
  });
  assert.equal(nokiaRes.totalCash, 540);
  assert.ok(indexRes.finalAssetValue > nokiaRes.finalAssetValue);
});

test('answerFinanceQuery answers taxi and safe-to-spend queries using real transaction sums', () => {
  const mikkoTxs = SEED_TRANSACTIONS.filter((t) => t.customerId === 'mikko');
  const taxiAns = answerFinanceQuery({
    query: 'How much did I spend on taxis last month?',
    persona: PERSONAS.mikko,
    transactions: mikkoTxs,
    overrides: [],
    includePsd2: false,
  });
  assert.match(taxiAns.text, /€143\.00/);
  assert.equal(taxiAns.chart?.kind, 'bar');

  const ainoTxs = SEED_TRANSACTIONS.filter((t) => t.customerId === 'aino');
  const safe = computeSafeToSpend(ainoTxs, [], false);
  assert.ok(safe.safeWeekly > 500);
});
