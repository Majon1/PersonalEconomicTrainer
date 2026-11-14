import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, ShieldCheck, Volume2, VolumeX } from 'lucide-react';
import { BasketsMeter } from './components/BasketsMeter';
import { FinanceChart } from './components/FinanceChart';
import { LockerView } from './components/LockerView';
import { PixelMentorScene } from './components/PixelMentorScene';
import {
  computeBaskets,
  detectSuspicionQuests,
  filterTransactions,
  getLatestMonthKey,
  levelFromXp,
  purchaseOrEquipItem,
  resolveInterrogationChoice,
  simulateWhatIf,
  xpProgressInLevel,
} from './game/engine';
import { soundFx } from './game/sound';
import type {
  BasketKey,
  ChartPayload,
  LabelOverride,
  MentorMood,
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
}

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
  { label: 'Taxis?', query: 'How much did I spend on taxis last month?' },
  { label: 'Safe/wk?', query: 'What is safe for me to spend this week?' },
  { label: 'Peers?', query: 'Compare me to Finnish peers' },
  { label: 'Netflix?', query: 'If Netflix went into an index fund' },
];

export default function App() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ledgerReady, setLedgerReady] = useState(false);
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState<{ role: 'user' | 'mentor'; text: string }[]>([]);
  const [userState, setUserState] = useState<SavedUserState | null>(null);
  const [lockerOpen, setLockerOpen] = useState(false);
  const [muted, setMuted] = useState(false);
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

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      soundFx.muted = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'm' || e.key === 'M') toggleMute();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleMute]);

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
  const xpInfo = xpProgressInLevel(progress?.xp ?? 0);

  if (loadError || !userState || !progress || !ledgerReady || !customerId) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center sm:p-4">
        <div
          data-testid="phone-shell"
          className="relative w-full sm:w-[398px] h-screen sm:h-[812px] sm:max-h-[94vh] flex items-center justify-center px-6 text-center sm:border-[3px]"
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

  const activeMood: MentorMood = customTurn
    ? customTurn.chart
      ? 'pointing'
      : customTurn.mood
    : activeQuest
      ? 'suspicious'
      : 'impressed';

  const activeSpeech: string = customTurn
    ? customTurn.text
    : activeQuest
      ? activeQuest.prompt
      : 'All flagged items checked. Ask me about taxis, safe-to-spend, or what-ifs.';

  const handleResetDemo = () => {
    soundFx.playClick();
    setUserState(buildInitialState(customerId));
    setHistory([]);
    setCustomTurn(null);
    setLevelUpToast(null);
    setLockerFeedback(null);
    setLockerOpen(false);
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
      soundFx.playBluffBuzz();
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
      soundFx.playLevelUp();
      setLevelUpToast(`Level ${nextLevel} unlocked (+35 Bonus Coins)`);
    } else {
      soundFx.playHonestChime();
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
    soundFx.playClick();
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
    soundFx.playClick();
    setChatInput('');
    setAsking(true);
    setCustomTurn({ mood: 'deadpan', text: 'Checking the ledger…' });
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          query: trimmed,
          overrides: userState.overrides,
          history,
        }),
      });
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
    soundFx.playClick();
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
    soundFx.playClick();
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
    soundFx.playHonestChime();
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
      soundFx.playBluffBuzz();
      setLockerFeedback(res.reason ?? 'Locked');
      return;
    }
    soundFx.playEquip();
    setUserState((prev) => (prev ? { ...prev, progress: res.next } : prev));
    setLockerFeedback(
      res.action === 'bought_and_equipped'
        ? `Unlocked & equipped ${item.name}.`
        : `Equipped ${item.name}.`,
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center sm:p-4">
      {/* Typical Mobile Phone Frame (398x812) */}
      <div
        data-testid="phone-shell"
        className="relative w-full sm:w-[398px] h-screen sm:h-[812px] sm:max-h-[94vh] flex flex-col overflow-hidden sm:border-[3px]"
        style={{
          backgroundColor: 'var(--app-bg)',
          borderColor: 'var(--app-border)',
          boxShadow: 'var(--pixel-shadow)',
        }}
      >
        {/* FULL-BLEED ANIMATED MIKKO ROOM BACKGROUND */}
        <PixelMentorScene
          mood={activeMood}
          styleId={progress.equippedStyle}
          slipsSharePct={slipsSharePct}
          streakWeeks={progress.streakWeeks}
          variant="background"
        />

        {/* FOREGROUND HUD LAYER */}
        <div className="relative z-10 flex flex-col h-full">
          {/* Top S-mobiili Header + Single-Row Baskets */}
          <header
            className="h-11 px-3 flex items-center justify-between gap-2 border-b-2 shrink-0"
            style={{
              backgroundColor: 'var(--app-surface)',
              borderColor: 'var(--app-border)',
            }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-num font-bold text-xs tracking-wider whitespace-nowrap">
                S-MOBIILI
              </span>
              <label className="sr-only" htmlFor="customer-picker">Customer</label>
              <select
                id="customer-picker"
                value={customerId}
                onChange={(e) => {
                  soundFx.playClick();
                  setLedgerReady(false);
                  setCustomerId(e.target.value);
                  const url = new URL(window.location.href);
                  url.searchParams.set('customer', e.target.value);
                  window.history.replaceState(null, '', url);
                }}
                className="max-w-[7.5rem] truncate font-num text-[11px] bg-transparent border border-[var(--app-border)] px-1 py-0.5"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.age}
                  </option>
                ))}
              </select>
              <span className="font-num text-xs font-bold whitespace-nowrap">
                L{progress.level} · {progress.coins}c
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  soundFx.playClick();
                  setLockerOpen(true);
                }}
                aria-label="Open Locker"
                className="h-7 px-2 flex items-center gap-1 text-[11px] font-semibold border border-[var(--app-border)] cursor-pointer"
                style={{ backgroundColor: 'var(--app-surface-muted)' }}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Locker</span>
              </button>

              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? 'Unmute sound' : 'Mute sound'}
                className="w-7 h-7 flex items-center justify-center border border-[var(--app-border)] cursor-pointer"
                style={{ backgroundColor: 'var(--app-surface-muted)' }}
              >
                {muted ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </header>

          <BasketsMeter
            baskets={baskets}
            lastShiftedBasket={lastShiftedBasket}
          />

          {/* OPEN STAGE WINDOW SO MIKKO & POINTING HAND STAY CLEAR */}
          <div className="flex-1 min-h-[215px]" aria-hidden="true" />

          {/* LOWER FLOATING RPG DIALOGUE OR CHART ZONE OVER DESK */}
          <main className="px-3 pb-2 space-y-1.5 min-h-0 overflow-y-auto">
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
                    setLockerOpen(true);
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
                <FinanceChart
                  chart={customTurn.chart}
                  onChangeWhatIfAsset={handleChangeWhatIfAsset}
                  onChangeWhatIfMonths={handleChangeWhatIfMonths}
                  onPledgeCutback={handlePledgeCutback}
                  pledgedActive={userState.pledgedActive}
                />
              </div>
            ) : (
              <section
                aria-label="Mikko Dialogue"
                className="pixel-card p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-num font-bold text-xs tracking-wide">
                    Mikko
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-num text-[11px] text-[var(--app-text-muted)]">
                      {xpInfo.currentInLevel}/{xpInfo.neededForNext} XP
                    </span>
                    <div
                      className="w-16 h-2 overflow-hidden"
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
                  </div>
                </div>

                <p
                  data-testid="mentor-speech"
                  className="text-xs leading-relaxed font-medium"
                >
                  {activeSpeech}
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

                {!customTurn?.offerWhatIf && activeQuest && (
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

                {customTurn && !customTurn.offerWhatIf && (
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

          {/* Minimal Ask Mikko Bar */}
          <footer
            className="p-2.5 border-t-2 space-y-1.5 shrink-0"
            style={{
              backgroundColor: 'var(--app-surface)',
              borderColor: 'var(--app-border)',
            }}
          >
            <div className="flex gap-1.5 overflow-x-auto">
              {QUICK_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => handleSendQuery(chip.query)}
                  disabled={asking}
                  className="px-2 py-1 text-[11px] font-semibold pixel-btn cursor-pointer whitespace-nowrap shrink-0"
                  style={{
                    backgroundColor: 'var(--app-surface-muted)',
                    color: 'var(--app-text)',
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendQuery(chatInput);
              }}
              className="flex gap-1.5"
            >
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
        </div>

        {/* Slide-Over Locker Drawer */}
        {lockerOpen && (
          <LockerView
            progress={progress}
            holderName="S-ASIAKAS"
            slipsSharePct={slipsSharePct}
            onSelectShopItem={handleSelectShopItem}
            onClose={() => setLockerOpen(false)}
            onResetDemo={handleResetDemo}
            feedbackMsg={lockerFeedback}
          />
        )}
      </div>
    </div>
  );
}
