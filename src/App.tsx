import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, LayoutGrid, X } from 'lucide-react';
import { BasketsMeter } from './components/BasketsMeter';
import { FinanceChart } from './components/FinanceChart';
import { LockerView } from './components/LockerView';
import { BudgetView } from './components/BudgetView';
import { FinlandWall, pctVsFinland } from './components/FinlandWall';
import { BottomNav, HomePage, MoneyInPage, SpendingPage, type PageKey } from './components/Pages';
import { PixelMentorScene } from './components/PixelMentorScene';
import {
  computeBaskets,
  checkPurchase,
  computeBudgetStatus,
  computeMoneyMood,
  computeSeasonCompare,
  seasonalHeadsUp,
  suggestBudget,
  detectSuspicionQuests,
  filterTransactions,
  getLatestMonthKey,
  levelFromXp,
  purchaseOrEquipItem,
  resolveInterrogationChoice,
  simulateWhatIf,
  xpProgressInLevel,
} from './game/engine';
import type {
  BasketKey,
  ChartPayload,
  LabelOverride,
  MentorMood,
  MoneyMoodLevel,
  Budget,
  PlayerProgress,
  ShopItem,
  Transaction,
  WhatIfAsset,
} from './game/types';

interface CustomerSummary {
  id: string;
  age: number;
  postalCode: string;
  transactions: number;
}

interface SavedUserState {
  forCustomer: string;
  progress: PlayerProgress;
  overrides: LabelOverride[];
  resolvedQuestIds: string[];
  pledgedActive: boolean;
  /** monthly limits for the "choose" baskets; null = no budget yet */
  budget?: Budget | null;
}

function storageKey(customerId: string) {
  return `strainer_${customerId}_v1`;
}

interface ActiveTurn {
  mood: MentorMood;
  text: string;
  chart?: ChartPayload;
  offerWhatIf?: {
    monthlyAmount: number;
    months: number;
    label: string;
  };
  /** Mikko asks whether to show the "You vs Finland" board */
  offerCompare?: boolean;
  /** category tapped on the You vs Finland wall */
  pick?: string;
}

const COMPARE_OFFER =
  'Curious how you stack up? Statistics Finland knows what other Finns your age spend. Want to compare?';

function buildInitialState(customerId: string): SavedUserState {
  const startingXp = 280;
  return {
    forCustomer: customerId,
    progress: {
      xp: startingXp,
      level: levelFromXp(startingXp),
      coins: 45,
      streakWeeks: 0,
      unlockedItems: [
        'style_classic_visor',
        'theme_spankki',
        'card_classic_green',
      ],
      equippedStyle: 'classic_visor',
      equippedTheme: 'spankki',
      equippedCardSkin: 'classic_green',
    },
    overrides: [],
    resolvedQuestIds: [],
    pledgedActive: false,
  };
}

function loadState(customerId: string): SavedUserState {
  try {
    const raw = window.localStorage.getItem(storageKey(customerId));
    if (raw) {
      const parsed = JSON.parse(raw) as SavedUserState;
      if (parsed?.progress) return { ...parsed, forCustomer: customerId };
    }
  } catch {
    // Ignore storage errors
  }
  return buildInitialState(customerId);
}

const QUICK_CHIPS = [
  { label: 'How am I doing?', query: 'How am I doing this month? Why are you in that mood?' },
  { label: 'Safe this week?', query: 'What is safe for me to spend this week?' },
  { label: 'Can I buy it?', query: '' },
  { label: 'Compare peers', query: 'Compare me to Finnish peers' },
  { label: 'Emergency fund', query: 'Do I have enough of an emergency fund?' },
  { label: 'Taxis?', query: 'How much did I spend on taxis last month?' },
  { label: 'Junk food?', query: 'How much did I spend on junk food this month (cafés, fast food, kiosk snacks)?' },
  { label: 'Fun?', query: 'How much did I spend on fun this month (events, hobbies, nights out)?' },
  { label: 'Seasons', query: '' },
];

// Status colours (good / warning / critical), always paired with an icon and label.
const MOOD_COLOR: Record<MoneyMoodLevel, string> = { happy: '#15803d', mild: '#b45309', angry: '#b91c1c' };
const MOOD_LABEL: Record<MoneyMoodLevel, string> = { happy: 'Doing well', mild: 'Could be better', angry: 'Rent at risk' };
const EF_COLOR = { reached: '#15803d', building: '#d97706', low: '#b91c1c' } as const;

export default function App() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ledgerReady, setLedgerReady] = useState(false);
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState<{ role: 'user' | 'mentor'; text: string }[]>([]);
  const [userState, setUserState] = useState<SavedUserState | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [page, setPage] = useState<PageKey>('mikko');
  const [chatInput, setChatInput] = useState('');
  const [lastShiftedBasket, setLastShiftedBasket] = useState<BasketKey | null>(
    null,
  );
  const [levelUpToast, setLevelUpToast] = useState<string | null>(null);
  const [lockerFeedback, setLockerFeedback] = useState<string | null>(null);
  const [customTurn, setCustomTurn] = useState<ActiveTurn | null>(null);

  const progress = userState?.progress;

  useEffect(() => {
    document.body.dataset.state = 'playing';
  }, []);

  useEffect(() => {
    if (!progress) return;
    if (progress.equippedTheme === 'spankki') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = progress.equippedTheme;
    }
  }, [progress]);

  useEffect(() => {
    let cancel = false;
    fetch('/api/customers')
      .then((res) => {
        if (!res.ok) throw new Error('customers');
        return res.json() as Promise<{ default: string | null; customers: CustomerSummary[] }>;
      })
      .then((index) => {
        if (cancel) return;
        setCustomers(index.customers);
        const requested = new URLSearchParams(window.location.search).get('customer');
        const initial = index.customers.some((c) => c.id === requested) ? requested : index.default;
        if (!initial) throw new Error('empty');
        setCustomerId(initial);
      })
      .catch(() => {
        if (!cancel) setLoadError('Could not load customers from Postgres.');
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!customerId) return;
    let cancel = false;
    setLedgerReady(false);
    setUserState(loadState(customerId));
    setHistory([]);
    setCustomTurn(null);
    setLevelUpToast(null);
    setLockerFeedback(null);
    setOverviewOpen(false);
    setTopicsOpen(false);
    fetch(`/api/customers/${customerId}`)
      .then((res) => {
        if (!res.ok) throw new Error('customer');
        return res.json() as Promise<{ transactions: Transaction[] }>;
      })
      .then((data) => {
        if (cancel) return;
        setTransactions(data.transactions);
        setLedgerReady(true);
      })
      .catch(() => {
        if (!cancel) setLoadError('Could not load this customer’s transactions.');
      });
    return () => {
      cancel = true;
    };
  }, [customerId]);

  useEffect(() => {
    if (!customerId || !userState || userState.forCustomer !== customerId) return;
    try {
      window.localStorage.setItem(storageKey(customerId), JSON.stringify(userState));
    } catch {
      // Ignore quota issues
    }
  }, [userState, customerId]);

  const allTxs = transactions;
  const visibleTxs = useMemo(
    () => filterTransactions(allTxs, false),
    [allTxs],
  );
  const latestMonth = useMemo(() => getLatestMonthKey(visibleTxs), [visibleTxs]);

  const baskets = useMemo(
    () => computeBaskets(visibleTxs, userState?.overrides ?? [], latestMonth),
    [visibleTxs, userState?.overrides, latestMonth],
  );

  const slipsSharePct = baskets.totalSpend
    ? Math.round((baskets.slips / baskets.totalSpend) * 100)
    : 0;

  const activeQuests = useMemo(
    () =>
      detectSuspicionQuests(
        allTxs,
        userState?.overrides ?? [],
        userState?.resolvedQuestIds ?? [],
        false,
      ),
    [allTxs, userState?.overrides, userState?.resolvedQuestIds],
  );

  const activeQuest = activeQuests[0] ?? null;

  const moneyMood = useMemo(
    () => computeMoneyMood(visibleTxs, userState?.overrides ?? [], latestMonth),
    [visibleTxs, userState?.overrides, latestMonth],
  );

  const budget = userState?.budget ?? null;
  const budgetSuggestion = useMemo(
    () => suggestBudget(visibleTxs, userState?.overrides ?? []),
    [visibleTxs, userState?.overrides],
  );
  const budgetStatus = useMemo(
    () => (budget ? computeBudgetStatus(visibleTxs, userState?.overrides ?? [], budget, latestMonth) : null),
    [budget, visibleTxs, userState?.overrides, latestMonth],
  );
  // A busy spending season in Finland in the next month or two (Statistics Finland).
  // Seasons follow the real calendar, not the last month in the data. For testing,
  // ?season=YYYY-MM pretends it's that month (e.g. ?season=2026-11 → Christmas).
  const seasonAhead = useMemo(() => {
    const forced = new URLSearchParams(window.location.search).get('season');
    const now = forced && /^\d{4}-\d{2}$/.test(forced) ? forced : new Date().toISOString().slice(0, 7);
    return seasonalHeadsUp(now);
  }, []);

  // What Mikko opens with, once per customer per session, most urgent first:
  // 1. rent at risk  2. a budget that's used up or nearly  3. the Finland comparison offer.
  useEffect(() => {
    if (!ledgerReady || !customerId) return;
    const key = `strainer_opening_${customerId}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, '1');
    } catch {
      // ignore storage errors
    }
    const worst = budgetStatus?.worst;
    if (moneyMood.level === 'angry') {
      setCustomTurn({ mood: 'bluff_caught', text: moneyMood.headline });
    } else if (worst) {
      setCustomTurn({
        mood: worst.status === 'over' ? 'bluff_caught' : 'suspicious',
        text:
          worst.status === 'over'
            ? `Your ${worst.label.toLowerCase()} budget is blown: €${worst.spent.toFixed(0)} of €${worst.limit.toFixed(0)}. Hold off on ${worst.label.toLowerCase()} until next month.`
            : `Heads up: €${Math.max(0, worst.left).toFixed(0)} left of your ${worst.label.toLowerCase()} budget with ${budgetStatus?.daysLeft} days to go. Check with me before you buy.`,
      });
    } else if (seasonAhead) {
      // A busy spending season is coming (Christmas, Black Friday, summer…).
      // …and still offer the You vs Finland board, where "Seasons" shows the full year.
      setCustomTurn({
        mood: 'pointing',
        text: `${seasonAhead.text} Want to see how you compare with other Finns?`,
        offerCompare: true,
      });
    } else {
      setCustomTurn({ mood: 'pointing', text: COMPARE_OFFER, offerCompare: true });
    }
  }, [ledgerReady, customerId, moneyMood, budgetStatus, seasonAhead]);

  if (loadError || !userState || !progress || !ledgerReady || !customerId) {
    return (
      <div className="min-h-[100dvh] w-full flex items-center justify-center framed:p-4">
        <div
          data-testid="phone-shell"
          className="relative w-full max-w-[560px] framed:w-[398px] h-[100dvh] framed:h-[812px] framed:max-h-[94vh] flex items-center justify-center px-6 text-center framed:border-[3px]"
          style={{
            backgroundColor: 'var(--app-bg)',
            borderColor: 'var(--app-border)',
          }}
        >
          <p className="text-sm font-medium">
            {loadError ?? 'Opening the ledger…'}
          </p>
        </div>
      </div>
    );
  }

  // Balance after the latest transaction, shown at the top of every page.
  const latestTx = visibleTxs.reduce<Transaction | null>(
    (a, t) => (!a || `${t.date} ${t.time}` > `${a.date} ${a.time}` ? t : a),
    null,
  );
  const accountBalance = latestTx?.balanceAfter ?? 0;
  const accountAsOf = latestTx
    ? new Date(`${latestTx.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '';

  const activeMood: MentorMood = customTurn
    ? customTurn.chart
      ? 'pointing'
      : customTurn.mood
    : activeQuest
      ? 'suspicious'
      : moneyMood.mentorMood;

  const activeSpeech: string = customTurn
    ? customTurn.text
    : activeQuest
      ? activeQuest.prompt
      : `${moneyMood.headline} Ask me about taxis, safe-to-spend, or what-ifs.`;

  const handleSaveBudget = (next: Budget | null) => {
    const firstTime = !userState.budget && next;
    setUserState((prev) => {
      if (!prev) return prev;
      const xp = prev.progress.xp + (firstTime ? 20 : 0);
      return { ...prev, budget: next, progress: { ...prev.progress, xp, level: levelFromXp(xp) } };
    });
    setBudgetOpen(false);
    setCustomTurn(
      next
        ? {
            mood: 'impressed',
            text: `Budget set: €${next.slips} for slips and €${next.nice_to_have} for nice-to-haves a month.${firstTime ? ' +20 XP.' : ''} Ask me before you buy and I'll tell you if it fits.`,
          }
        : { mood: 'deadpan', text: 'Budget removed. I will still flag anything that puts the rent at risk.' },
    );
  };

  const handleCheckPurchase = (amount: number, category: string, what: string) => {
    const v = checkPurchase({ transactions: visibleTxs, overrides: userState.overrides, budget, amount, category, what });
    setBudgetOpen(false);
    setCustomTurn({
      mood: v.mood,
      text: `${v.verdict === 'go' ? '👍' : v.verdict === 'think' ? '🤔' : '✋'} ${v.text}${v.reasons.length > 1 ? ` Also: ${v.reasons.slice(1).join('; ')}.` : ''}`,
    });
  };

  const handleCompareYes = async () => {
    setTopicsOpen(false);
    setOverviewOpen(false);
    setAsking(true);
    setCustomTurn({ mood: 'deadpan', text: 'Pulling the Statistics Finland numbers…' });
    try {
      const [res] = await Promise.all([
        fetch(`/api/customers/${customerId}/compare`),
        new Promise((resolve) => window.setTimeout(resolve, 580)),
      ]);
      const board = await res.json();
      if (!res.ok) throw new Error(board.error || 'No comparison available');
      const diff = board.yoursTotal - board.finlandTotal;
      const top = [...board.rows].sort(
        (a: { yours: number; finland: number }, b: { yours: number; finland: number }) =>
          b.yours - b.finland - (a.yours - a.finland),
      )[0];
      const bottom = [...board.rows].sort(
        (a: { yours: number; finland: number }, b: { yours: number; finland: number }) =>
          a.yours - a.finland - (b.yours - b.finland),
      )[0];
      setCustomTurn({
        mood: 'pointing',
        text:
          `You spend €${Math.abs(diff).toFixed(0)}/month ${diff > 0 ? 'more' : 'less'} than other Finns aged ${board.ageGroup}. ` +
          `Biggest gap: ${top.category} (+€${(top.yours - top.finland).toFixed(0)}). ` +
          `You're under them in ${board.lessCount} categor${board.lessCount === 1 ? 'y' : 'ies'}, best in ${bottom.category}. Tap a category on the wall for details.`,
        chart: board,
      });
    } catch (error) {
      setCustomTurn({ mood: 'deadpan', text: error instanceof Error ? error.message : 'Could not load the comparison.' });
    } finally {
      setAsking(false);
    }
  };

  // Tap a tile on the You vs Finland wall: Mikko explains that category.
  const handlePickCategory = (category: string) => {
    if (customTurn?.chart?.kind !== 'finland_board') return;
    const board = customTurn.chart;
    const row = board.rows.find((r) => r.category === category);
    if (!row) return;
    const pct = pctVsFinland(row);
    const diff = row.yours - row.finland;
    const sign = diff >= 0 ? '+' : '−';
    const tip =
      row.verdict === 'more'
        ? category === 'Housing'
          ? ' Note: the survey average includes owners, who pay no rent, so it runs low.'
          : ' That is where the gap is.'
        : row.verdict === 'less'
          ? ' Nice, you are below average here.'
          : ' Right on the Finnish average.';
    setCustomTurn({
      ...customTurn,
      pick: category,
      mood: row.verdict === 'more' ? 'suspicious' : row.verdict === 'less' ? 'impressed' : 'deadpan',
      text: `${category}: you spend €${row.yours.toFixed(0)}/month, other Finns aged ${board.ageGroup} spend €${row.finland.toFixed(0)} (${sign}€${Math.abs(diff).toFixed(0)}, ${pct > 0 ? '+' : ''}${pct}%).${tip}`,
    });
  };

  const handleShowMood = () => {
    const r = moneyMood.reasons;
    const lines = [...r.bad, ...r.meh, ...r.good.slice(0, 2)].map((x) => x.charAt(0).toUpperCase() + x.slice(1));
    setCustomTurn({
      mood: moneyMood.mentorMood,
      text: `${MOOD_LABEL[moneyMood.level]} (${moneyMood.score}/100) in ${moneyMood.month}. ${lines.join('. ')}.${moneyMood.season ? ` ${moneyMood.season}` : ''}`,
    });
  };

  // "Seasons" on the You vs Finland wall: your year next to Finland's.
  const handleShowSeasons = () => {
    const chart = computeSeasonCompare(visibleTxs, userState.overrides);
    const ahead = seasonAhead ? ` Coming up: ${seasonAhead.title}.` : '';
    setCustomTurn({
      mood: 'pointing',
      text: `Your busiest month is ${chart.yourPeak}; Finland's is ${chart.finlandPeak}. January and February are the quiet months for most Finns.${ahead}`,
      chart,
    });
  };

  const handleShowEmergencyFund = () => {
    const ef = moneyMood.emergency;
    setCustomTurn({
      mood: 'pointing',
      text:
        ef.status === 'reached'
          ? `Emergency fund: €${ef.balance.toFixed(0)} covers ${ef.monthsCovered.toFixed(1)} months of spending. Goal of ${ef.goalMonths} months reached.`
          : `Emergency fund: €${ef.balance.toFixed(0)} covers ${ef.monthsCovered.toFixed(1)} months. ${ef.goalMonths} months would be €${ef.target.toFixed(0)}, so €${ef.missing.toFixed(0)} to go. Small, steady transfers after payday get you there.`,
      chart: {
        kind: 'emergency_fund',
        title: 'Emergency fund',
        balance: ef.balance,
        target: ef.target,
        goalMonths: ef.goalMonths,
        monthsCovered: ef.monthsCovered,
        monthlyOutgoings: ef.monthlyOutgoings,
        status: ef.status,
      },
    });
  };

  const handleResetDemo = () => {
    setUserState(buildInitialState(customerId));
    setHistory([]);
    setCustomTurn(null);
    setLevelUpToast(null);
    setLockerFeedback(null);
    setPage('mikko');
  };

  const handleAnswerQuest = (choiceId: string) => {
    if (!activeQuest) return;
    const tx = allTxs.find((t) => t.id === activeQuest.txId);
    if (!tx) return;

    const res = resolveInterrogationChoice({
      quest: activeQuest,
      tx,
      choiceId,
    });

    if (!res.accepted) {
      setCustomTurn({
        mood: 'bluff_caught',
        text: res.mentorReply,
      });
      return;
    }

    const oldLevel = progress.level;
    const nextXp = progress.xp + res.xpEarned;
    const nextLevel = levelFromXp(nextXp);
    const leveledUp = nextLevel > oldLevel;

    setUserState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        overrides: res.override
          ? [...prev.overrides, res.override]
          : prev.overrides,
        resolvedQuestIds: [...prev.resolvedQuestIds, activeQuest.id],
        progress: {
          ...prev.progress,
          xp: nextXp,
          level: nextLevel,
          coins: prev.progress.coins + res.coinsEarned + (leveledUp ? 35 : 0),
        },
      };
    });

    if (res.override) {
      setLastShiftedBasket(res.override.basket);
      setTimeout(() => setLastShiftedBasket(null), 1500);
    }

    if (leveledUp) {
      setLevelUpToast(`Level ${nextLevel} unlocked (+35 Bonus Coins)`);
    } else {
    }

    const isNetflix =
      res.override?.customLabel === 'Netflix' ||
      res.override?.customLabel === 'Streaming';

    if (isNetflix) {
      setCustomTurn({
        mood: 'pointing',
        text: res.mentorReply,
        offerWhatIf: {
          monthlyAmount: activeQuest.amount,
          months: activeQuest.repeatMonths ?? 18,
          label: `If you skipped Netflix (€${activeQuest.amount.toFixed(2)}/mo · ${activeQuest.repeatMonths ?? 18} mos)`,
        },
      });
    } else {
      setCustomTurn({
        mood: leveledUp ? 'level_up' : res.mood,
        text: res.mentorReply,
      });
    }
  };

  const handleOpenOfferedChart = () => {
    if (!customTurn?.offerWhatIf) return;
    const { monthlyAmount, months, label } = customTurn.offerWhatIf;
    const result = simulateWhatIf({
      monthlyAmount,
      months,
      asset: 'index_fund',
      title: label,
    });
    setCustomTurn({
      mood: 'pointing',
      text: `Look below: €${monthlyAmount.toFixed(2)}/mo in a Global Index Fund becomes €${result.finalAssetValue.toFixed(2)} (+€${result.deltaVsCash.toFixed(2)} vs cash).`,
      chart: {
        kind: 'what_if',
        sourceLabel: label,
        result,
      },
    });
  };

  const handleSendQuery = async (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (!trimmed || asking) return;
    setChatInput('');
    setTopicsOpen(false);
    setOverviewOpen(false);
    setAsking(true);
    setCustomTurn({ mood: 'deadpan', text: 'Checking your ledger…' });
    try {
      const [res] = await Promise.all([
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId,
            query: trimmed,
            overrides: userState.overrides,
            budget: userState.budget ?? null,
            history,
          }),
        }),
        new Promise((resolve) => window.setTimeout(resolve, 680)),
      ]);
      const answer = await res.json();
      if (!res.ok) throw new Error(answer.error || 'Chat failed');
      setHistory((prev) => [
        ...prev,
        { role: 'user', text: trimmed },
        { role: 'mentor', text: answer.text },
      ]);
      setCustomTurn({
        mood: answer.chart ? 'pointing' : answer.mood,
        text: answer.text,
        chart: answer.chart,
      });
    } catch (error) {
      setCustomTurn({
        mood: 'deadpan',
        text: error instanceof Error ? error.message : 'Mikko could not answer.',
      });
    } finally {
      setAsking(false);
    }
  };

  const handleChangeWhatIfAsset = (asset: WhatIfAsset) => {
    if (customTurn?.chart?.kind !== 'what_if') return;
    const prevRes = customTurn.chart.result;
    const updated = simulateWhatIf({
      monthlyAmount: prevRes.monthlyAmount,
      months: prevRes.months,
      asset,
      title: prevRes.title,
    });
    setCustomTurn({
      ...customTurn,
      mood: 'pointing',
      text:
        asset === 'nokia'
          ? `Nokia replay lands at €${updated.finalAssetValue.toFixed(2)} vs €${updated.finalSavingsValue.toFixed(2)} in S-Savings. Single stocks swing.`
          : asset === 'index_fund'
            ? `Index Fund replay builds €${updated.finalAssetValue.toFixed(2)} (+€${updated.deltaVsCash.toFixed(2)} over idle cash).`
            : `S-Savings (2.75%) lands at €${updated.finalSavingsValue.toFixed(2)}. Safe, steady.`,
      chart: {
        ...customTurn.chart,
        result: updated,
      },
    });
  };

  const handleChangeWhatIfMonths = (months: number) => {
    if (customTurn?.chart?.kind !== 'what_if') return;
    const prevRes = customTurn.chart.result;
    const updated = simulateWhatIf({
      monthlyAmount: prevRes.monthlyAmount,
      months,
      asset: prevRes.asset,
      title: prevRes.title,
    });
    setCustomTurn({
      ...customTurn,
      mood: 'pointing',
      text: `Over ${months} months, €${updated.monthlyAmount.toFixed(2)}/mo reaches €${updated.finalAssetValue.toFixed(2)}.`,
      chart: {
        ...customTurn.chart,
        result: updated,
      },
    });
  };

  const handlePledgeCutback = (label: string, monthlyAmount: number) => {
    if (userState.pledgedActive) return;
    setUserState((prev) => {
      if (!prev) return prev;
      const nextXp = prev.progress.xp + 25;
      const nextLvl = levelFromXp(nextXp);
      return {
        ...prev,
        pledgedActive: true,
        progress: {
          ...prev.progress,
          xp: nextXp,
          level: nextLvl,
          coins: prev.progress.coins + 15,
          streakWeeks: prev.progress.streakWeeks + 1,
        },
      };
    });
    setCustomTurn({
      mood: 'impressed',
      text: `Pledge active (${label}, €${monthlyAmount.toFixed(2)}/mo). +25 XP. Keep under cap for 7 days.`,
    });
  };

  const handleSelectShopItem = (item: ShopItem) => {
    const res = purchaseOrEquipItem(progress, item);
    if (!res.ok) {
      setLockerFeedback(res.reason ?? 'Locked');
      return;
    }
    setUserState((prev) => (prev ? { ...prev, progress: res.next } : prev));
    setLockerFeedback(
      res.action === 'bought_and_equipped'
        ? `Unlocked & equipped ${item.name}.`
        : `Equipped ${item.name}.`,
    );
  };

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center framed:p-4">
      <div
        data-testid="phone-shell"
        className="relative w-full max-w-[560px] framed:w-[398px] h-[100dvh] framed:h-[812px] framed:max-h-[94vh] flex flex-col overflow-hidden framed:border-[3px]"
        style={{
          backgroundColor: 'var(--app-bg)',
          borderColor: 'var(--app-border)',
          boxShadow: 'var(--pixel-shadow)',
        }}
      >
        <div className="relative z-10 flex flex-col h-full">
          <div
            data-testid="test-bar"
            className="min-h-7 px-3 py-0.5 flex items-center justify-between gap-2 border-b text-[10px] shrink-0"
            style={{
              paddingTop: 'env(safe-area-inset-top)',
              backgroundColor: 'var(--app-surface-muted)',
              borderColor: 'var(--app-border)',
            }}
          >
            <span className="font-num uppercase tracking-wider text-[var(--app-text-muted)] font-semibold">
              Test profile
            </span>
            <select
              id="customer-picker"
              aria-label="Test profile"
              value={customerId}
              onChange={(e) => {
                setLedgerReady(false);
                setCustomerId(e.target.value);
                const url = new URL(window.location.href);
                url.searchParams.set('customer', e.target.value);
                window.history.replaceState(null, '', url);
              }}
              className="font-num text-[11px] font-semibold bg-[var(--app-bg)] border border-[var(--app-border)] px-1.5 py-0.5 cursor-pointer"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.id.replace('CUST', '')} · {c.age}y
                </option>
              ))}
            </select>
          </div>

          <header
            className="min-h-11 px-3 flex items-center justify-between gap-2 border-b-2 shrink-0"
            style={{
              backgroundColor: 'var(--app-surface)',
              borderColor: 'var(--app-border)',
            }}
          >
            <span className="font-num font-bold text-xs tracking-wider whitespace-nowrap">
              S-MOBIILI
            </span>

            {(() => {
              const xpInfo = xpProgressInLevel(progress.xp);
              return (
                <div
                  data-testid="xp-bar"
                  className="flex items-center gap-2 shrink-0"
                  aria-label={`Level ${progress.level}, ${xpInfo.currentInLevel} of ${xpInfo.neededForNext} XP, ${progress.coins} coins`}
                >
                  <span className="font-num text-xs font-bold whitespace-nowrap">
                    Lvl {progress.level}
                  </span>
                  <div
                    className="w-20 h-2.5 overflow-hidden"
                    style={{
                      backgroundColor: 'var(--app-surface-muted)',
                      border: '1px solid var(--app-border)',
                    }}
                  >
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${xpInfo.pct}%`,
                        backgroundColor: 'var(--app-accent-bright)',
                      }}
                    />
                  </div>
                  <span className="font-num text-[11px] font-semibold text-[var(--app-text-muted)] whitespace-nowrap">
                    {xpInfo.currentInLevel}/{xpInfo.neededForNext} · {progress.coins}c
                  </span>
                </div>
              );
            })()}
          </header>

          <div
            className="px-3 py-1.5 flex items-center justify-between gap-2 border-b-2 shrink-0"
            style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)' }}
            data-testid="account-balance"
          >
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span
                className="font-num text-sm font-bold shrink-0"
                style={{ color: accountBalance < 0 ? 'var(--app-danger)' : 'var(--app-text)' }}
              >
                {accountBalance < 0 ? '−' : ''}€{Math.abs(accountBalance).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[11px] text-[var(--app-text-muted)] truncate">
                {page === 'mikko'
                  ? `· €${baskets.totalSpend.toFixed(0)} spent`
                  : `· ${accountAsOf}`}
              </span>
            </div>
            {page === 'mikko' && (
              <button
                type="button"
                data-testid="overview-toggle"
                aria-expanded={overviewOpen}
                onClick={() => setOverviewOpen((o) => !o)}
                className="px-2 py-0.5 flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer shrink-0 border border-[var(--app-border)]"
                style={{ backgroundColor: overviewOpen ? 'var(--app-bg)' : 'var(--app-surface-muted)' }}
              >
                <span className="flex items-center gap-0.5" aria-hidden="true">
                  <i className="w-1.5 h-1.5 inline-block" style={{ backgroundColor: '#007a45' }} />
                  <i className="w-1.5 h-1.5 inline-block" style={{ backgroundColor: '#2563eb' }} />
                  <i className="w-1.5 h-1.5 inline-block" style={{ backgroundColor: '#c25e00' }} />
                  <i className="w-1.5 h-1.5 inline-block" style={{ backgroundColor: '#7c3aed' }} />
                </span>
                <span>Overview</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${overviewOpen ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>

          {page !== 'mikko' ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              {page === 'spending' && <SpendingPage transactions={visibleTxs} overrides={userState.overrides} />}
              {page === 'money_in' && <MoneyInPage transactions={visibleTxs} />}
              {page === 'home' && <HomePage customerId={customerId} transactions={visibleTxs} />}
              {page === 'locker' && (
                <LockerView
                  embedded
                  progress={progress}
                  holderName="S-ASIAKAS"
                  slipsSharePct={slipsSharePct}
                  onSelectShopItem={handleSelectShopItem}
                  onResetDemo={handleResetDemo}
                  feedbackMsg={lockerFeedback}
                />
              )}
            </div>
          ) : (
          <>
          <div className="relative flex-1 min-h-0 flex flex-col">
            {overviewOpen && (
              <div
                data-testid="overview-panel"
                className="absolute top-0 left-0 right-0 z-30 shadow-md"
              >
                <BasketsMeter
                  baskets={baskets}
                  monthKey={latestMonth}
                  lastShiftedBasket={lastShiftedBasket}
                />

                <div
                  className="grid grid-cols-[1fr_1fr_auto] gap-1 px-2 py-1 short:hidden border-b"
                  style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)' }}
                >
                  <button
                    type="button"
                    data-testid="money-mood"
                    onClick={() => {
                      setOverviewOpen(false);
                      handleShowMood();
                    }}
                    className="px-1.5 py-1 flex items-center gap-1 min-w-0 text-left cursor-pointer"
                    style={{ backgroundColor: 'var(--app-surface-muted)', border: `1px solid ${MOOD_COLOR[moneyMood.level]}` }}
                    aria-label={`Money mood ${moneyMood.level}, score ${moneyMood.score} of 100. Tap for details.`}
                  >
                    <span
                      className="w-3.5 h-3.5 shrink-0 grid place-items-center text-[9px] font-bold text-white"
                      style={{ backgroundColor: MOOD_COLOR[moneyMood.level] }}
                      aria-hidden="true"
                    >
                      {moneyMood.level === 'happy' ? '✓' : moneyMood.level === 'mild' ? '–' : '!'}
                    </span>
                    <span className="text-[10px] font-semibold truncate">{MOOD_LABEL[moneyMood.level]}</span>
                    <span className="font-num text-[10px] font-bold ml-auto shrink-0">{moneyMood.score}</span>
                  </button>

                  <button
                    type="button"
                    data-testid="emergency-fund"
                    onClick={() => {
                      setOverviewOpen(false);
                      handleShowEmergencyFund();
                    }}
                    className="px-1.5 py-1 min-w-0 text-left cursor-pointer"
                    style={{ backgroundColor: 'var(--app-surface-muted)', border: '1px solid var(--app-border)' }}
                    aria-label={`Emergency fund ${moneyMood.emergency.monthsCovered.toFixed(1)} of ${moneyMood.emergency.goalMonths} months. Tap for details.`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-semibold truncate">Fund</span>
                      <span className="font-num text-[10px] font-bold shrink-0">
                        {Math.min(99, moneyMood.emergency.monthsCovered).toFixed(1)}/{moneyMood.emergency.goalMonths} mo
                      </span>
                    </div>
                    <div className="h-1 mt-0.5" style={{ backgroundColor: 'var(--app-surface)', border: '1px solid var(--app-border)' }}>
                      <div
                        className="h-full"
                        style={{
                          width: `${moneyMood.emergency.progressPct}%`,
                          backgroundColor: EF_COLOR[moneyMood.emergency.status],
                        }}
                      />
                    </div>
                  </button>

                  <button
                    type="button"
                    data-testid="budget-bar"
                    onClick={() => {
                      setOverviewOpen(false);
                      setBudgetOpen(true);
                    }}
                    className="px-2 py-1 flex items-center gap-1 text-[10px] font-semibold cursor-pointer shrink-0"
                    style={{ backgroundColor: 'var(--app-surface-muted)', border: '1px solid var(--app-border)' }}
                    aria-label={budgetStatus ? 'Budget this month. Tap to edit or check a purchase.' : 'Set a monthly budget'}
                  >
                    <span>
                      {budgetStatus?.worst
                        ? `€${Math.max(0, budgetStatus.worst.left).toFixed(0)} left`
                        : 'Budget'}
                    </span>
                    <ChevronRight className="w-3 h-3 shrink-0" />
                  </button>
                </div>
                <button
                  type="button"
                  data-testid="open-seasons"
                  onClick={() => {
                    setOverviewOpen(false);
                    handleShowSeasons();
                  }}
                  className="w-full px-2 py-1 flex items-center justify-between gap-2 text-[10px] font-semibold border-b-2 cursor-pointer"
                  style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)' }}
                >
                  <span>Seasons{seasonAhead ? `: ${seasonAhead.title}` : ''}</span>
                  <ChevronRight className="w-3 h-3 shrink-0" />
                </button>
              </div>
            )}

            <div className="relative h-[296px] shrink-0 short:h-[140px]">
              <div aria-hidden="true">
                <PixelMentorScene
                  mood={activeMood}
                  styleId={progress.equippedStyle}
                  slipsSharePct={slipsSharePct}
                  streakWeeks={progress.streakWeeks}
                  thinking={asking}
                  variant="background"
                />
              </div>
              {customTurn?.chart?.kind === 'finland_board' && (
                <FinlandWall
                  board={customTurn.chart}
                  picked={customTurn.pick}
                  onPick={handlePickCategory}
                  onSeasons={handleShowSeasons}
                  onClose={() => {
                    setCustomTurn(null);
                  }}
                />
              )}
            </div>

            <main
              className="flex-1 min-h-0 px-3 pt-1.5 pb-2 space-y-1.5 overflow-y-auto"
              style={{ backgroundColor: '#6f451f' }}
            >
              {levelUpToast && (
                <div
                  data-testid="level-up-banner"
                  className="px-2.5 py-1 text-[11px] font-semibold flex items-center justify-between gap-2 border-2"
                  style={{
                    backgroundColor: 'var(--app-accent)',
                    color: 'var(--app-accent-fg)',
                    borderColor: 'var(--app-border)',
                  }}
                >
                  <span>{levelUpToast}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setLevelUpToast(null);
                      setPage('locker');
                    }}
                    className="underline shrink-0 cursor-pointer"
                  >
                    Locker
                  </button>
                </div>
              )}
              {customTurn?.chart ? (
                <div className="space-y-1.5">
                  <div
                    data-testid="mentor-speech"
                    className="pixel-card px-3 py-2 text-xs leading-snug font-medium flex items-start justify-between gap-2"
                  >
                    <span>
                      <strong className="font-num">Mikko:</strong> {activeSpeech}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCustomTurn(null)}
                      className="text-[11px] font-semibold underline shrink-0 cursor-pointer text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
                    >
                      {activeQuest ? 'Next' : 'Close'}
                    </button>
                  </div>
                  <div className={customTurn.chart.kind === 'finland_board' ? 'hidden short:block' : ''}>
                    <FinanceChart
                      chart={customTurn.chart}
                      onChangeWhatIfAsset={handleChangeWhatIfAsset}
                      onChangeWhatIfMonths={handleChangeWhatIfMonths}
                      onPledgeCutback={handlePledgeCutback}
                      pledgedActive={userState.pledgedActive}
                    />
                  </div>
                </div>
              ) : (
                <section
                  aria-label="Mikko Dialogue"
                  className="pixel-card p-3 space-y-2"
                >
                  <div className="font-num font-bold text-xs tracking-wide">
                    Mikko · Money Coach
                  </div>

                <p
                  data-testid="mentor-speech"
                  className="text-xs leading-relaxed font-medium"
                >
                  {asking ? 'Grabbing my notes… checking your numbers.' : activeSpeech}
                </p>

                {customTurn?.offerWhatIf && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleOpenOfferedChart}
                      className="min-h-[40px] px-3 text-xs font-semibold pixel-btn cursor-pointer flex items-center justify-center gap-1"
                      style={{
                        backgroundColor: 'var(--app-accent)',
                        color: 'var(--app-accent-fg)',
                      }}
                    >
                      <span>Show Chart</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomTurn(null)}
                      className="min-h-[40px] px-3 text-xs font-semibold pixel-btn cursor-pointer"
                      style={{
                        backgroundColor: 'var(--app-surface-muted)',
                        color: 'var(--app-text)',
                      }}
                    >
                      Next Check
                    </button>
                  </div>
                )}

                {customTurn?.offerCompare && (
                  <div className="grid grid-cols-2 gap-2" data-testid="compare-offer">
                    <button
                      type="button"
                      onClick={handleCompareYes}
                      className="min-h-[38px] px-3 text-xs font-semibold pixel-btn cursor-pointer flex items-center justify-center gap-1"
                      style={{ backgroundColor: 'var(--app-accent)', color: 'var(--app-accent-fg)' }}
                    >
                      <span>Compare to Finland</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomTurn(null);
                      }}
                      className="min-h-[38px] px-3 text-xs font-semibold pixel-btn cursor-pointer"
                      style={{ backgroundColor: 'var(--app-surface-muted)', color: 'var(--app-text)' }}
                    >
                      {activeQuest ? 'Check Spend (+XP)' : 'Ask a Question'}
                    </button>
                  </div>
                )}

                {!customTurn && activeQuest && (
                  <div className="space-y-1.5" data-testid="suspicion-quest">
                    {activeQuest.choices.map((ch) => (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => handleAnswerQuest(ch.id)}
                        className="w-full min-h-[38px] px-3 py-1.5 text-left text-xs font-semibold pixel-btn flex items-center justify-between gap-2 cursor-pointer"
                        style={{
                          backgroundColor: 'var(--app-surface-muted)',
                          color: 'var(--app-text)',
                        }}
                      >
                        <span>{ch.label}</span>
                        <span className="font-num text-[11px] text-[var(--app-text-muted)] shrink-0">
                          {ch.xp > 0 ? `+${ch.xp} XP` : 'Claim'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {customTurn && !customTurn.offerWhatIf && !customTurn.offerCompare && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setCustomTurn(null)}
                      className="px-3 py-1.5 text-xs font-semibold pixel-btn cursor-pointer"
                      style={{
                        backgroundColor: 'var(--app-surface-muted)',
                        color: 'var(--app-text)',
                      }}
                    >
                      {activeQuest ? 'Back to Check' : 'Clear'}
                    </button>
                  </div>
                )}

              </section>
            )}
          </main>
          </div>

          <footer
            className="relative p-2 border-t-2 shrink-0"
            style={{
              backgroundColor: 'var(--app-surface)',
              borderColor: 'var(--app-border)',
            }}
          >
            {topicsOpen && (
              <div
                data-testid="topics-menu"
                className="absolute left-2 right-2 bottom-full mb-1.5 pixel-card p-2.5 space-y-2 z-20"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-num text-[11px] font-bold uppercase tracking-wide">
                    Quick prompts
                  </span>
                  <button
                    type="button"
                    onClick={() => setTopicsOpen(false)}
                    aria-label="Close quick prompts"
                    className="p-0.5 cursor-pointer text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {QUICK_CHIPS.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => {
                        setTopicsOpen(false);
                        if (chip.label === 'Compare peers') {
                          handleCompareYes();
                        } else if (chip.label === 'Can I buy it?') {
                          setBudgetOpen(true);
                        } else if (chip.label === 'Seasons') {
                          handleShowSeasons();
                        } else {
                          handleSendQuery(chip.query);
                        }
                      }}
                      disabled={asking}
                      className="px-2.5 py-2 text-left text-[11px] font-semibold pixel-btn cursor-pointer truncate"
                      style={{
                        backgroundColor: 'var(--app-surface-muted)',
                        color: 'var(--app-text)',
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendQuery(chatInput);
              }}
              className="flex gap-1.5"
            >
              <button
                type="button"
                data-testid="topics-toggle"
                onClick={() => setTopicsOpen((o) => !o)}
                aria-expanded={topicsOpen}
                aria-label="Quick prompts"
                title="Quick prompts"
                disabled={asking}
                className="min-h-[38px] px-2.5 flex items-center justify-center pixel-btn cursor-pointer shrink-0"
                style={{
                  backgroundColor: topicsOpen ? 'var(--app-bg)' : 'var(--app-surface-muted)',
                  color: 'var(--app-text)',
                }}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <label htmlFor="coach-input" className="sr-only">
                Ask Mikko
              </label>
              <input
                id="coach-input"
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={asking ? 'Mikko is looking…' : 'Ask Mikko...'}
                disabled={asking}
                className="flex-1 min-h-[38px] px-3 text-xs border-2 bg-[var(--app-bg)] border-[var(--app-border)] focus:outline-none focus:border-[var(--app-accent)]"
              />
              <button
                type="submit"
                disabled={asking}
                className="min-h-[38px] px-3.5 text-xs font-semibold pixel-btn cursor-pointer whitespace-nowrap"
                style={{
                  backgroundColor: 'var(--app-accent)',
                  color: 'var(--app-accent-fg)',
                }}
              >
                {asking ? '…' : 'Ask'}
              </button>
            </form>
          </footer>
          </>
          )}

          <BottomNav
            page={page}
            onChange={(p) => {
              setOverviewOpen(false);
              setTopicsOpen(false);
              setPage(p);
            }}
          />
        </div>

        {budgetOpen && (
          <BudgetView
            budget={budget}
            suggestion={budgetSuggestion}
            status={budgetStatus}
            onSave={handleSaveBudget}
            onCheckPurchase={handleCheckPurchase}
            onClose={() => setBudgetOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

