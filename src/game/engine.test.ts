import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, SEED_TRANSACTIONS, SHOP_CATALOG } from './data';
import {
  answerFinanceQuery,
  computeBaskets,
  computeSafeToSpend,
  detectSuspicionQuests,
  levelFromXp,
  purchaseOrEquipItem,
  resolveInterrogationChoice,
  simulateWhatIf,
} from './engine';
import type { LabelOverride, PlayerProgress } from './types';

test('computeBaskets totals and live label override shifts euros across baskets', () => {
  const mikkoTxs = SEED_TRANSACTIONS.filter(
    (t) => t.customerId === 'mikko' && t.source === 'sbank',
  );
  const before = computeBaskets(mikkoTxs, [], '2026-09');
  assert.equal(before.mandatory_regular, 1251);
  assert.equal(before.mandatory_irregular, 404);
  assert.equal(before.slips, 353.99);

  // Override MRC-LIF-0042 (€14.99) from Slips -> Mandatory & Regular
  const overrides: LabelOverride[] = [
    {
      merchantId: 'MRC-LIF-0042',
      customLabel: 'Streaming',
      basket: 'mandatory_regular',
    },
  ];
  const after = computeBaskets(mikkoTxs, overrides, '2026-09');
  assert.equal(after.mandatory_regular, 1265.99);
  assert.equal(after.slips, 339);
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
