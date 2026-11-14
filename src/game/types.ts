export type PersonaId = 'mikko' | 'aino';

/**
 * Four baskets: two you must pay, two you choose.
 *  mandatory_regular   rent, bills, groceries, commuting
 *  mandatory_irregular health, repairs, appliances
 *  slips               small habits that slip through your fingers (<= 40 €: coffees, quick lunches, taxis, parking)
 *  nice_to_have        bigger extras you could live without if money got tight (travel, hobbies, events, shopping, dinners out)
 */
export type BasketKey = 'mandatory_regular' | 'mandatory_irregular' | 'slips' | 'nice_to_have';

export type MoneyMoodLevel = 'happy' | 'mild' | 'angry';

/** Monthly limits the user sets for the two "choose" baskets, plus optional per-category limits. */
export interface Budget {
  slips: number;
  nice_to_have: number;
  categories: Record<string, number>;
}

export interface BudgetLine {
  key: string; // 'slips' | 'nice_to_have' | category name
  label: string;
  limit: number;
  spent: number;
  left: number;
  pct: number;
  projected: number; // at this pace by the end of the month
  status: 'ok' | 'close' | 'over';
}

export interface BudgetStatus {
  month: string;
  today: string;
  daysLeft: number;
  lines: BudgetLine[];
  /** the line most in trouble, if any */
  worst: BudgetLine | null;
}

export interface PurchaseVerdict {
  verdict: 'go' | 'think' | 'stop';
  mood: MentorMood;
  basket: BasketKey;
  text: string;
  reasons: string[];
}

export interface RiskyPurchase {
  txId: string;
  date: string;
  label: string;
  basket: BasketKey;
  amount: number;
  balanceAfter: number;
  billsDueBeforeIncome: number;
}

export interface EmergencyFund {
  month: string;
  goalMonths: number;
  monthlyOutgoings: number;
  target: number;
  alternativeTargetPay: number;
  balance: number;
  monthsCovered: number;
  progressPct: number;
  missing: number;
  status: 'reached' | 'building' | 'low';
}

export interface MoneyMood {
  month: string;
  level: MoneyMoodLevel;
  /** Mikko's face for this mood: angry = bluff_caught, mild = suspicious, happy = impressed */
  mentorMood: MentorMood;
  score: number;
  headline: string;
  reasons: { bad: string[]; meh: string[]; good: string[] };
  risky: RiskyPurchase[];
  emergency: EmergencyFund;
}

export type MentorMood =
  | 'deadpan'
  | 'suspicious'
  | 'pointing'
  | 'bluff_caught'
  | 'impressed'
  | 'level_up';

export type MentorStyleId =
  | 'classic_visor'
  | 'detective_coat'
  | 'eight_bit_shades'
  | 'sauna_beanie'
  | 'golden_crown';

export type AppThemeId = 'spankki' | 'gameboy' | 'nokia3310' | 'midnight';

export type CardSkinId =
  | 'classic_green'
  | 'emerald_foil'
  | 'nokia_brick'
  | 'golden_possu'
  | 'holo_prism';

export type WhatIfAsset = 'index_fund' | 'nokia' | 'savings';

export type BankCategory =
  | 'Salary'
  | 'Housing'
  | 'Utilities'
  | 'Groceries'
  | 'Restaurants'
  | 'Transportation'
  | 'Entertainment'
  | 'Health'
  | 'Lifestyle'
  | 'Home & Tech'
  | 'Travel';

export interface Transaction {
  id: string;
  customerId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  category: BankCategory | string;
  amount: number; // negative = spend, positive = income
  balanceAfter: number;
  merchantId: string;
  merchantType?: string;
  mcc: string;
  source: 'sbank' | 'psd2_external';
  note?: string;
  type?: string;
}

export interface LabelOverride {
  merchantId?: string;
  txId?: string;
  customLabel: string;
  basket: BasketKey;
}

export interface SuspicionQuest {
  id: string;
  txId: string;
  merchantId: string;
  reason: 'mystery_repeat' | 'late_night_slip' | 'spike_anomaly' | 'psd2_hidden';
  prompt: string;
  amount: number;
  repeatCount?: number;
  repeatMonths?: number;
  choices: {
    id: string;
    label: string;
    customLabel: string;
    basket: BasketKey;
    xp: number;
    coins: number;
  }[];
}

export interface BasketSummary {
  mandatory_regular: number;
  mandatory_irregular: number;
  slips: number;
  nice_to_have: number;
  totalSpend: number;
  income: number;
  /** money moved to investments: not spending */
  saved: number;
}

export interface StatFinBenchmark {
  ageGroup: string;
  city: string;
  restaurantsAvg: number;
  transportAvg: number;
  groceriesAvg: number;
  slipsAvg: number;
}

export interface PersonaConfig {
  id: PersonaId;
  name: string;
  age: number;
  city: string;
  subtitle: string;
  startingXp: number;
  startingCoins: number;
  streakWeeks: number;
  unlockedItems: string[];
  equippedStyle: MentorStyleId;
  equippedTheme: AppThemeId;
  equippedCardSkin: CardSkinId;
  benchmark: StatFinBenchmark;
}

export interface ShopItem {
  id: string;
  slot: 'mentor_style' | 'app_theme' | 'card_skin';
  value: MentorStyleId | AppThemeId | CardSkinId;
  name: string;
  description: string;
  requiredLevel: number;
  coinCost: number;
}

export interface WhatIfPoint {
  monthIndex: number;
  label: string;
  cashPile: number;
  assetValue: number;
  savingsValue: number;
}

export interface WhatIfResult {
  title: string;
  monthlyAmount: number;
  months: number;
  asset: WhatIfAsset;
  assetLabel: string;
  totalCash: number;
  finalAssetValue: number;
  finalSavingsValue: number;
  deltaVsCash: number;
  deltaVsSavings: number;
  points: WhatIfPoint[];
}

export type ChartPayload =
  | {
      kind: 'bar';
      title: string;
      subtitle: string;
      bars: { label: string; value: number; highlight?: boolean }[];
    }
  | {
      kind: 'what_if';
      result: WhatIfResult;
      sourceLabel: string;
    }
  | {
      kind: 'safe_to_spend';
      title: string;
      currentBalance: number;
      reservedRegular: number;
      surpriseBuffer: number;
      safeWeekly: number;
      dailyAllowance: number;
    }
  | {
      kind: 'finland_board';
      title: string;
      ageGroup: string;
      period: string;
      priceNote: string;
      rows: {
        category: string;
        yours: number;
        finland: number;
        verdict: 'more' | 'less' | 'similar';
      }[];
      yoursTotal: number;
      finlandTotal: number;
      lessCount: number;
      source: string;
      caveat: string;
    }
  | {
      kind: 'emergency_fund';
      title: string;
      balance: number;
      target: number;
      goalMonths: number;
      monthsCovered: number;
      monthlyOutgoings: number;
      status: 'reached' | 'building' | 'low';
    }
  | {
      kind: 'peer_compare';
      title: string;
      subtitle: string;
      rows: {
        category: string;
        yours: number;
        finlandAvg: number;
      }[];
    };

export interface ChatMessage {
  id: string;
  sender: 'user' | 'mentor';
  text: string;
  mood?: MentorMood;
  chart?: ChartPayload;
}

export interface PlayerProgress {
  xp: number;
  level: number;
  coins: number;
  streakWeeks: number;
  unlockedItems: string[];
  equippedStyle: MentorStyleId;
  equippedTheme: AppThemeId;
  equippedCardSkin: CardSkinId;
}
