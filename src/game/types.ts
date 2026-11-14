export type PersonaId = 'mikko' | 'aino';

export type BasketKey = 'mandatory_regular' | 'mandatory_irregular' | 'slips';

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
  totalSpend: number;
  income: number;
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
