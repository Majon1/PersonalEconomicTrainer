import { SHOP_CATALOG } from './data';
import type {
  BasketKey,
  BasketSummary,
  ChartPayload,
  LabelOverride,
  MentorMood,
  PersonaConfig,
  PlayerProgress,
  ShopItem,
  SuspicionQuest,
  Transaction,
  WhatIfAsset,
  WhatIfPoint,
  WhatIfResult,
} from './types';

export const XP_PER_LEVEL = 150;

export function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1);
}

export function xpProgressInLevel(xp: number): {
  level: number;
  currentInLevel: number;
  neededForNext: number;
  pct: number;
} {
  const level = levelFromXp(xp);
  const floor = (level - 1) * XP_PER_LEVEL;
  const currentInLevel = Math.max(0, xp - floor);
  return {
    level,
    currentInLevel,
    neededForNext: XP_PER_LEVEL,
    pct: Math.min(100, Math.round((currentInLevel / XP_PER_LEVEL) * 100)),
  };
}

export function defaultBasketForTx(tx: Transaction): BasketKey {
  if (
    tx.category === 'Housing' ||
    tx.category === 'Utilities' ||
    tx.category === 'Groceries' ||
    tx.mcc === '4111' ||
    tx.mcc === '5541' ||
    tx.mcc === '5542'
  ) {
    return 'mandatory_regular';
  }
  if (
    tx.category === 'Health' ||
    tx.category === 'Home & Tech' ||
    tx.category === 'Travel'
  ) {
    return 'mandatory_irregular';
  }
  return 'slips';
}

export function resolveTxBasket(
  tx: Transaction,
  overrides: LabelOverride[],
): { basket: BasketKey; customLabel?: string } {
  const byTx = overrides.find((o) => o.txId === tx.id);
  if (byTx) return { basket: byTx.basket, customLabel: byTx.customLabel };

  const byMerchant = overrides.find((o) => o.merchantId === tx.merchantId);
  if (byMerchant) {
    return { basket: byMerchant.basket, customLabel: byMerchant.customLabel };
  }

  return { basket: defaultBasketForTx(tx) };
}

export function getLatestMonthKey(transactions: Transaction[]): string {
  const dates = transactions.map((t) => t.date.slice(0, 7)).sort();
  return dates[dates.length - 1] ?? '2026-09';
}

export function filterTransactions(
  transactions: Transaction[],
  includePsd2: boolean,
  monthKey?: string,
): Transaction[] {
  return transactions.filter((tx) => {
    if (!includePsd2 && tx.source === 'psd2_external') return false;
    if (monthKey && !tx.date.startsWith(monthKey)) return false;
    return true;
  });
}

export function computeBaskets(
  transactions: Transaction[],
  overrides: LabelOverride[],
  monthKey?: string,
): BasketSummary {
  const targetMonth = monthKey ?? getLatestMonthKey(transactions);
  const summary: BasketSummary = {
    mandatory_regular: 0,
    mandatory_irregular: 0,
    slips: 0,
    totalSpend: 0,
    income: 0,
  };

  for (const tx of transactions) {
    if (!tx.date.startsWith(targetMonth)) continue;
    if (tx.amount > 0) {
      summary.income += tx.amount;
      continue;
    }
    const abs = Math.abs(tx.amount);
    const { basket } = resolveTxBasket(tx, overrides);
    summary[basket] += abs;
    summary.totalSpend += abs;
  }

  summary.mandatory_regular = round2(summary.mandatory_regular);
  summary.mandatory_irregular = round2(summary.mandatory_irregular);
  summary.slips = round2(summary.slips);
  summary.totalSpend = round2(summary.totalSpend);
  summary.income = round2(summary.income);
  return summary;
}

export function detectSuspicionQuests(
  transactions: Transaction[],
  overrides: LabelOverride[],
  resolvedIds: string[],
  includePsd2: boolean,
): SuspicionQuest[] {
  const latestMonth = getLatestMonthKey(transactions);
  const visible = filterTransactions(transactions, includePsd2);
  const latest = visible.filter((t) => t.date.startsWith(latestMonth));
  const quests: SuspicionQuest[] = [];

  const isOverridden = (tx: Transaction) =>
    overrides.some((o) => o.txId === tx.id || o.merchantId === tx.merchantId);

  const labelFor = (tx: Transaction) => tx.merchantType || tx.merchantId;

  // 1. Repeating Lifestyle/Entertainment merchant
  const repeatCandidates = latest.filter(
    (t) =>
      t.amount < 0 &&
      (t.category === 'Lifestyle' || t.category === 'Entertainment') &&
      !isOverridden(t),
  );
  const seenMerchants = new Set<string>();
  for (const tx of repeatCandidates) {
    if (seenMerchants.has(tx.merchantId)) continue;
    seenMerchants.add(tx.merchantId);
    const history = visible.filter((v) => v.merchantId === tx.merchantId);
    const historyCount = history.length;
    const months = new Set(history.map((v) => v.date.slice(0, 7))).size;
    if (historyCount < 2 && months < 2) continue;
    const qId = `quest-repeat-${tx.merchantId}`;
    if (resolvedIds.includes(qId)) continue;
    if (quests.filter((q) => q.reason === 'mystery_repeat' || q.reason === 'psd2_hidden').length >= 4) break;
    quests.push({
      id: qId,
      txId: tx.id,
      merchantId: tx.merchantId,
      reason: tx.source === 'psd2_external' ? 'psd2_hidden' : 'mystery_repeat',
      amount: Math.abs(tx.amount),
      repeatCount: historyCount,
      repeatMonths: months,
      prompt:
        tx.source === 'psd2_external'
          ? `Found on your linked card: €${Math.abs(tx.amount).toFixed(2)} at ${labelFor(tx)}. Thought I wouldn't check?`
          : `€${Math.abs(tx.amount).toFixed(2)} to ${labelFor(tx)} (${historyCount} charges, ${months} mo). Bank says "${tx.category}". What is it actually?`,
      choices: [
        {
          id: 'streaming',
          label: 'Netflix / Streaming',
          customLabel: 'Netflix',
          basket: 'mandatory_regular',
          xp: 35,
          coins: 25,
        },
        {
          id: 'unused_sub',
          label: 'Membership I barely use',
          customLabel: 'Unused Sub',
          basket: 'slips',
          xp: 40,
          coins: 30,
        },
        {
          id: 'phone_plan',
          label: 'Phone / internet add-on',
          customLabel: 'Phone Plan',
          basket: 'mandatory_regular',
          xp: 25,
          coins: 15,
        },
      ],
    });
  }

  // 2. Late-night taxi or bar slip (00:00 - 04:59)
  const lateNight = latest.find(
    (t) =>
      t.amount < 0 &&
      (t.mcc === '4121' || t.category === 'Restaurants') &&
      Number.parseInt(t.time.slice(0, 2), 10) < 5 &&
      !isOverridden(t) &&
      !resolvedIds.includes(`quest-night-${t.id}`),
  );
  if (lateNight) {
    quests.push({
      id: `quest-night-${lateNight.id}`,
      txId: lateNight.id,
      merchantId: lateNight.merchantId,
      reason: 'late_night_slip',
      amount: Math.abs(lateNight.amount),
      prompt: `€${Math.abs(lateNight.amount).toFixed(2)} at ${lateNight.time.slice(0, 5)} on ${lateNight.date} (${labelFor(lateNight)}). Be honest: need or slip?`,
      choices: [
        {
          id: 'honest_slip',
          label: 'Night out — slipped',
          customLabel: 'Late-Night Taxi',
          basket: 'slips',
          xp: 30,
          coins: 20,
        },
        {
          id: 'work_shift',
          label: 'Late work / emergency',
          customLabel: 'Emergency Ride',
          basket: 'mandatory_irregular',
          xp: 15,
          coins: 10,
        },
        {
          id: 'claim_regular',
          label: 'Mandatory & Regular',
          customLabel: 'Regular Bill',
          basket: 'mandatory_regular',
          xp: 0,
          coins: 0,
        },
      ],
    });
  }

  // 3. Large Home & Tech spike (> €150)
  const techSpike = latest.find(
    (t) =>
      t.amount < 0 &&
      t.category === 'Home & Tech' &&
      Math.abs(t.amount) >= 150 &&
      !isOverridden(t) &&
      !resolvedIds.includes(`quest-spike-${t.id}`),
  );
  if (techSpike) {
    quests.push({
      id: `quest-spike-${techSpike.id}`,
      txId: techSpike.id,
      merchantId: techSpike.merchantId,
      reason: 'spike_anomaly',
      amount: Math.abs(techSpike.amount),
      prompt: `€${Math.abs(techSpike.amount).toFixed(2)} at ${labelFor(techSpike)} (Home & Tech). Broken appliance or impulse upgrade?`,
      choices: [
        {
          id: 'broken_appliance',
          label: 'Broken appliance (Mandatory)',
          customLabel: 'Appliance Repair',
          basket: 'mandatory_irregular',
          xp: 25,
          coins: 15,
        },
        {
          id: 'impulse_gadget',
          label: 'Impulse gadget (Be honest)',
          customLabel: 'Impulse Tech',
          basket: 'slips',
          xp: 40,
          coins: 30,
        },
      ],
    });
  }

  return quests;
}

export function resolveInterrogationChoice(params: {
  quest: SuspicionQuest;
  tx: Transaction;
  choiceId: string;
}): {
  accepted: boolean;
  bluffCaught: boolean;
  mood: MentorMood;
  mentorReply: string;
  xpEarned: number;
  coinsEarned: number;
  override?: LabelOverride;
} {
  const { quest, tx, choiceId } = params;
  const choice = quest.choices.find((c) => c.id === choiceId);
  if (!choice) {
    return {
      accepted: false,
      bluffCaught: false,
      mood: 'deadpan',
      mentorReply: 'Pick one of the answers.',
      xpEarned: 0,
      coinsEarned: 0,
    };
  }

  const hour = Number.parseInt(tx.time.slice(0, 2), 10);
  const isLateNightTaxiOrFood =
    (tx.mcc === '4121' || tx.mcc === '5814' || tx.category === 'Restaurants') &&
    hour < 5;

  if (isLateNightTaxiOrFood && choice.basket === 'mandatory_regular') {
    return {
      accepted: false,
      bluffCaught: true,
      mood: 'bluff_caught',
      mentorReply: `A ${tx.time} ride (MCC ${tx.mcc}) is not rent. Drop the excuse and take the +30 XP for honesty.`,
      xpEarned: 0,
      coinsEarned: 0,
    };
  }

  const isMerchantWide = quest.reason === 'mystery_repeat' || quest.reason === 'psd2_hidden';
  const isNetflix = choice.customLabel === 'Netflix' || choice.customLabel === 'Streaming';
  return {
    accepted: true,
    bluffCaught: false,
    mood: isNetflix ? 'pointing' : choice.xp >= 30 ? 'impressed' : 'deadpan',
    mentorReply: isNetflix
      ? `Logged as Netflix (€${quest.amount.toFixed(2)}/mo). Want to see what could have happened if you didn't use Netflix?`
      : `Logged "${choice.customLabel}" (+${choice.xp} XP, +${choice.coins}c). Baskets updated.`,
    xpEarned: choice.xp,
    coinsEarned: choice.coins,
    override: {
      merchantId: isMerchantWide ? tx.merchantId : undefined,
      txId: isMerchantWide ? undefined : tx.id,
      customLabel: choice.customLabel,
      basket: choice.basket,
    },
  };
}

export function computeSafeToSpend(
  transactions: Transaction[],
  overrides: LabelOverride[],
  includePsd2: boolean,
): {
  currentBalance: number;
  reservedRegular: number;
  surpriseBuffer: number;
  safeWeekly: number;
  dailyAllowance: number;
} {
  const visible = filterTransactions(transactions, includePsd2);
  const sorted = [...visible].sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
  );
  const latestTx = sorted[sorted.length - 1];
  const currentBalance = latestTx ? latestTx.balanceAfter : 0;

  const latestMonth = getLatestMonthKey(visible);
  const baskets = computeBaskets(visible, overrides, latestMonth);

  // Reserve 35% of monthly regular bills for upcoming cycle + 25% of irregular median
  const reservedRegular = round2(baskets.mandatory_regular * 0.35);
  const surpriseBuffer = round2(Math.max(80, baskets.mandatory_irregular * 0.4));
  const rawFree = Math.max(0, currentBalance - reservedRegular - surpriseBuffer);
  const safeWeekly = round2(rawFree / 3.2);
  const dailyAllowance = round2(safeWeekly / 7);

  return {
    currentBalance: round2(currentBalance),
    reservedRegular,
    surpriseBuffer,
    safeWeekly,
    dailyAllowance,
  };
}

export function simulateWhatIf(params: {
  monthlyAmount: number;
  months: number;
  asset: WhatIfAsset;
  title?: string;
}): WhatIfResult {
  const { monthlyAmount, months, asset, title } = params;
  const safeMonths = Math.max(1, Math.min(120, Math.round(months)));
  const points: WhatIfPoint[] = [];

  let cashPile = 0;
  let savingsValue = 0;
  let assetValue = 0;

  const monthlySavingsRate = 0.0275 / 12;

  for (let m = 1; m <= safeMonths; m++) {
    cashPile += monthlyAmount;
    savingsValue = (savingsValue + monthlyAmount) * (1 + monthlySavingsRate);

    let r = 0;
    if (asset === 'index_fund') {
      // Steady ~8.2% annual return with mild realistic market waves
      const wave = Math.sin(m * 0.65) * 0.011;
      r = 0.0068 + wave;
    } else if (asset === 'nokia') {
      // Volatile Finnish single-stock cycle including real drawdown periods
      const cycle = Math.sin(m * 0.55) * 0.055 + Math.cos(m * 0.25) * 0.028;
      r = -0.004 + cycle;
    } else {
      r = monthlySavingsRate;
    }

    assetValue = (assetValue + monthlyAmount) * (1 + r);

    // Sample points cleanly for SVG chart (every month if <= 24, else every N months + final)
    const step = safeMonths <= 24 ? 1 : Math.ceil(safeMonths / 18);
    if (m === 1 || m === safeMonths || m % step === 0) {
      points.push({
        monthIndex: m,
        label: safeMonths <= 24 ? `M${m}` : `${(m / 12).toFixed(1)}y`,
        cashPile: round2(cashPile),
        assetValue: round2(assetValue),
        savingsValue: round2(savingsValue),
      });
    }
  }

  const assetLabel =
    asset === 'index_fund'
      ? 'Global Index Fund (Default)'
      : asset === 'nokia'
        ? 'Nokia (NOKIA.HE)'
        : 'S-Savings (2.75%)';

  const finalAssetValue = round2(assetValue);
  const finalSavingsValue = round2(savingsValue);
  const totalCash = round2(cashPile);

  return {
    title: title ?? `€${monthlyAmount.toFixed(2)}/mo over ${safeMonths} months`,
    monthlyAmount: round2(monthlyAmount),
    months: safeMonths,
    asset,
    assetLabel,
    totalCash,
    finalAssetValue,
    finalSavingsValue,
    deltaVsCash: round2(finalAssetValue - totalCash),
    deltaVsSavings: round2(finalAssetValue - finalSavingsValue),
    points,
  };
}

export function answerFinanceQuery(params: {
  query: string;
  persona: PersonaConfig;
  transactions: Transaction[];
  overrides: LabelOverride[];
  includePsd2: boolean;
}): {
  text: string;
  mood: MentorMood;
  chart?: ChartPayload;
} {
  const { query, persona, transactions, overrides, includePsd2 } = params;
  const q = query.toLowerCase();
  const visible = filterTransactions(transactions, includePsd2);
  const latestMonth = getLatestMonthKey(visible);
  const latest = visible.filter((t) => t.date.startsWith(latestMonth));

  // 1. Taxis query
  if (q.includes('taxi') || q.includes('taksi') || q.includes('4121')) {
    const taxis = latest.filter((t) => t.mcc === '4121' && t.amount < 0);
    const total = round2(taxis.reduce((s, t) => s + Math.abs(t.amount), 0));
    const avgRide = taxis.length ? round2(total / taxis.length) : 0;

    // Monthly series across July-Sep
    const byMonth = ['2026-07', '2026-08', '2026-09'].map((m) => {
      const mTotal = visible
        .filter((t) => t.date.startsWith(m) && t.mcc === '4121' && t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      return {
        label: m.slice(5) === '07' ? 'Jul' : m.slice(5) === '08' ? 'Aug' : 'Sep',
        value: round2(mTotal),
        highlight: m === latestMonth,
      };
    });

    return {
      mood: total > 80 ? 'suspicious' : 'impressed',
      text:
        taxis.length === 0
          ? `Zero taxi charges in ${latestMonth}. Keep walking.`
          : `€${total.toFixed(2)} across ${taxis.length} taxi rides in ${latestMonth} (avg €${avgRide.toFixed(2)}/ride). ${total > 80 ? 'Almost all of it after midnight.' : 'Well within reason.'}`,
      chart: {
        kind: 'bar',
        title: 'Taxi Spend (MCC 4121)',
        subtitle: `${latestMonth} · €${total.toFixed(2)} across ${taxis.length} rides`,
        bars: byMonth,
      },
    };
  }

  // 2. Safe to spend
  if (q.includes('safe') || q.includes('week') || q.includes('spend')) {
    const safe = computeSafeToSpend(transactions, overrides, includePsd2);
    return {
      mood: safe.safeWeekly < 90 ? 'suspicious' : 'impressed',
      text: `Safe to spend this week: €${safe.safeWeekly.toFixed(2)} (€${safe.dailyAllowance.toFixed(2)}/day). I locked €${safe.reservedRegular.toFixed(0)} for upcoming bills and €${safe.surpriseBuffer.toFixed(0)} for surprises.`,
      chart: {
        kind: 'safe_to_spend',
        title: 'Weekly Safe-to-Spend Guardrail',
        ...safe,
      },
    };
  }

  // 3. Peer comparison (Statistics Finland)
  if (
    q.includes('peer') ||
    q.includes('average') ||
    q.includes('finland') ||
    q.includes('compare') ||
    q.includes('kind of spender')
  ) {
    const restaurants = round2(
      latest
        .filter((t) => t.category === 'Restaurants' && t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    );
    const transport = round2(
      latest
        .filter((t) => t.category === 'Transportation' && t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    );
    const groceries = round2(
      latest
        .filter((t) => t.category === 'Groceries' && t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    );
    const baskets = computeBaskets(visible, overrides, latestMonth);
    const b = persona.benchmark;

    return {
      mood: baskets.slips > b.slipsAvg ? 'suspicious' : 'impressed',
      text:
        baskets.slips > b.slipsAvg
          ? `Your slips are €${baskets.slips.toFixed(0)}/mo vs. €${b.slipsAvg} for ${b.ageGroup} in ${b.city} (Stats Finland). Restaurants alone hit €${restaurants.toFixed(0)}.`
          : `You beat the ${b.city} ${b.ageGroup} average: €${baskets.slips.toFixed(0)} in slips vs. €${b.slipsAvg} Finnish peer average.`,
      chart: {
        kind: 'peer_compare',
        title: `You vs. Stats Finland (${b.ageGroup}, ${b.city})`,
        subtitle: `${latestMonth} monthly spend comparison`,
        rows: [
          { category: 'Restaurants', yours: restaurants, finlandAvg: b.restaurantsAvg },
          { category: 'Transport', yours: transport, finlandAvg: b.transportAvg },
          { category: 'Groceries', yours: groceries, finlandAvg: b.groceriesAvg },
          { category: 'All Slips', yours: baskets.slips, finlandAvg: b.slipsAvg },
        ],
      },
    };
  }

  // 4. What-if / cutback / dining out / netflix / nokia / index
  if (
    q.includes('what if') ||
    q.includes('save') ||
    q.includes('netflix') ||
    q.includes('stream') ||
    q.includes('nokia') ||
    q.includes('index') ||
    q.includes('dining') ||
    q.includes('20%')
  ) {
    const asset: WhatIfAsset = q.includes('nokia') ? 'nokia' : 'index_fund';
    const isDining = q.includes('dining') || q.includes('restaurant') || q.includes('20%');

    let monthlyAmount = 14.99;
    let months = 36;
    let sourceLabel = 'Streaming bill replay (€14.99/mo)';

    if (isDining) {
      const diningTotal = latest
        .filter((t) => t.category === 'Restaurants' && t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      monthlyAmount = round2(Math.max(15, diningTotal * 0.2));
      months = 60;
      sourceLabel = `20% dining cutback (€${monthlyAmount.toFixed(2)}/mo · 5 yrs)`;
    }

    const res = simulateWhatIf({
      monthlyAmount,
      months,
      asset,
      title: sourceLabel,
    });

    const gain = res.deltaVsCash;
    return {
      mood: gain >= 0 ? 'impressed' : 'suspicious',
      text:
        asset === 'nokia'
          ? `Replaying €${monthlyAmount.toFixed(2)}/mo over ${months} mos in NOKIA.HE lands at €${res.finalAssetValue.toFixed(2)} vs. €${res.finalSavingsValue.toFixed(2)} in S-Savings. Single stocks swing—check the Index Fund toggle.`
          : `Redirecting €${monthlyAmount.toFixed(2)}/mo into a Global Index Fund for ${months} mos builds €${res.finalAssetValue.toFixed(2)} (€${gain >= 0 ? '+' : ''}${gain.toFixed(2)} over idle cash).`,
      chart: {
        kind: 'what_if',
        result: res,
        sourceLabel,
      },
    };
  }

  // Default fallback: 3-basket diagnostic
  const baskets = computeBaskets(visible, overrides, latestMonth);
  const slipPct = baskets.totalSpend
    ? Math.round((baskets.slips / baskets.totalSpend) * 100)
    : 0;
  return {
    mood: slipPct > 22 ? 'suspicious' : 'deadpan',
    text: `${latestMonth} total spend: €${baskets.totalSpend.toFixed(2)}. ${slipPct}% (€${baskets.slips.toFixed(2)}) slipped through your fingers. Ask about taxis, peers, safe-to-spend, or a 20% cutback.`,
  };
}

export function purchaseOrEquipItem(
  progress: PlayerProgress,
  item: ShopItem,
): {
  ok: boolean;
  reason?: string;
  next: PlayerProgress;
  action: 'equipped' | 'bought_and_equipped' | 'locked';
} {
  const alreadyOwned = progress.unlockedItems.includes(item.id);
  if (!alreadyOwned) {
    if (progress.level < item.requiredLevel) {
      return {
        ok: false,
        reason: `Requires Level ${item.requiredLevel}`,
        next: progress,
        action: 'locked',
      };
    }
    if (progress.coins < item.coinCost) {
      return {
        ok: false,
        reason: `Needs ${item.coinCost} Coins`,
        next: progress,
        action: 'locked',
      };
    }
  }

  const next: PlayerProgress = {
    ...progress,
    coins: alreadyOwned ? progress.coins : progress.coins - item.coinCost,
    unlockedItems: alreadyOwned
      ? progress.unlockedItems
      : [...progress.unlockedItems, item.id],
    equippedStyle:
      item.slot === 'mentor_style'
        ? (item.value as PlayerProgress['equippedStyle'])
        : progress.equippedStyle,
    equippedTheme:
      item.slot === 'app_theme'
        ? (item.value as PlayerProgress['equippedTheme'])
        : progress.equippedTheme,
    equippedCardSkin:
      item.slot === 'card_skin'
        ? (item.value as PlayerProgress['equippedCardSkin'])
        : progress.equippedCardSkin,
  };

  return {
    ok: true,
    next,
    action: alreadyOwned ? 'equipped' : 'bought_and_equipped',
  };
}

export function getShopItemById(id: string): ShopItem | undefined {
  return SHOP_CATALOG.find((item) => item.id === id);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
