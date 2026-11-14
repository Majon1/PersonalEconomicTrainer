import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, SEED_TRANSACTIONS, SHOP_CATALOG } from './data';
import {
  answerFinanceQuery,
  checkPurchase,
  computeBaskets,
  computeBudgetStatus,
  computeEmergencyFund,
  suggestBudget,
  computeMoneyMood,
  computeSafeToSpend,
  detectRiskyPurchases,
  detectSuspicionQuests,
  levelFromXp,
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
