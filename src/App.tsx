import { useEffect, useMemo, useRef, useState } from 'react';
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
  activeBudget,
  memoryFromQuest,
  mergeBudgets,
  mergeMemory,
  purchaseOrEquipItem,
  rememberQuest,
  sanitizeBudget,
  sanitizeMemoryEntry,
  sanitizeProgress,
  sanitizeSavedBudget,
  saveBudgetVersion,
  withMemoryOverrides,
  resolveInterrogationChoice,
  simulateWhatIf,
  xpProgressInLevel,
} from './game/engine';
import type {
  BasketKey,
  ChartPayload,
  LabelOverride,
  MentorMood,
  MikkoMemory,
  MoneyMoodLevel,
  Budget,
  PlayerProgress,
  SavedBudget,
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
  /** when `progress` last changed; the newer of this and the server's copy wins */
  progressAt?: string;
  overrides: LabelOverride[];
  resolvedQuestIds: string[];
  pledgedActive: boolean;
  /** every budget they made; the newest one not ended is in force */
  budgets?: SavedBudget[];
  /** older saves kept a single budget here; moved into `budgets` on load */
  budget?: Budget | null;
  /** every question Mikko asked and what the user did with it */
  memory?: MikkoMemory[];
  /** the last chat turns, so Mikko keeps the thread after a reload */
  chat?: ChatTurn[];
}

interface ChatTurn {
  role: 'user' | 'mentor';
  text: string;
}

const CHAT_KEEP = 12;
/** How far below the top of the room a message may reach (his desk line); matches the max-h classes on <main>. */
const MESSAGE_TOP = 248;
const MESSAGE_TOP_SHORT = 112;
/** Mikko's room: one fixed height from the top, so he is always drawn at the same size. */
const SCENE_BOX = 'absolute inset-x-0 top-0 h-[296px] short:h-[140px]';
/** Mikko keeps looking for at least this long, even when the answer is already back. */
const PONDER_MS = 2000;

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
  /** the request failed; this sends it again */
  retry?: () => void;
}

const COMPARE_OFFER =
  'Curious how you stack up? Statistics Finland knows what other Finns your age spend. Want to compare?';

// #01957 is the demo account that can buy every outfit and card skin.
const DEMO_CUSTOMER = 'CUST01957';
const DEMO_XP = 1650;
const DEMO_COINS = 600;
const STARTER_XP = 280;
const STARTER_COINS = 45;

function progressFor(customerId: string, progress: PlayerProgress): PlayerProgress {
  if (customerId === DEMO_CUSTOMER) {
    if (progress.xp >= DEMO_XP) return progress;
    return { ...progress, xp: DEMO_XP, level: levelFromXp(DEMO_XP), coins: Math.max(progress.coins, DEMO_COINS) };
  }
  // The boost was briefly saved for every customer. Put an untouched copy back.
  const starters = ['style_classic_visor', 'theme_spankki', 'card_classic_green'];
  const untouched =
    progress.xp === DEMO_XP &&
    progress.coins === DEMO_COINS &&
    progress.unlockedItems.length === starters.length &&
    starters.every((id) => progress.unlockedItems.includes(id));
  if (!untouched) return progress;
  return { ...progress, xp: STARTER_XP, level: levelFromXp(STARTER_XP), coins: STARTER_COINS };
}

function buildInitialState(customerId: string): SavedUserState {
  return {
    forCustomer: customerId,
    progress: progressFor(customerId, {
      xp: STARTER_XP,
      level: levelFromXp(STARTER_XP),
      coins: STARTER_COINS,
      streakWeeks: 0,
      unlockedItems: [
        'style_classic_visor',
        'theme_spankki',
        'card_classic_green',
      ],
      equippedStyle: 'classic_visor',
      equippedTheme: 'spankki',
      equippedCardSkin: 'classic_green',
    }),
    overrides: [],
    resolvedQuestIds: [],
    pledgedActive: false,
    budgets: [],
    memory: [],
    chat: [],
  };
}

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadState(customerId: string): SavedUserState {
  try {
    const raw = window.localStorage.getItem(storageKey(customerId));
    if (raw) {
      const parsed = JSON.parse(raw) as SavedUserState;
      if (parsed?.progress) {
        const budgets = (parsed.budgets ?? []).map(sanitizeSavedBudget).filter((b): b is SavedBudget => b !== null);
        const legacy = !parsed.budgets && parsed.budget ? sanitizeBudget(parsed.budget) : null;
        if (legacy) budgets.push({ id: newId(), budget: legacy, createdAt: new Date().toISOString() });
        return { ...parsed, budgets, budget: undefined, forCustomer: customerId, progress: progressFor(customerId, parsed.progress) };
      }
    }
  } catch {
    // Ignore storage errors
  }
  return buildInitialState(customerId);
}

// Mikko's memory lives in Postgres; the copy in localStorage covers the moments
// the server can't be reached, and is pushed up on the next load.
async function fetchServerMemory(customerId: string): Promise<MikkoMemory[] | null> {
  try {
    const res = await fetch(`/api/customers/${customerId}/memory`);
    if (!res.ok) return null;
    const body = (await res.json()) as { memory?: unknown[] };
    return (body.memory ?? []).map(sanitizeMemoryEntry).filter((m): m is MikkoMemory => m !== null);
  } catch {
    return null;
  }
}

function saveServerMemory(customerId: string, entries: MikkoMemory[]) {
  if (!entries.length) return;
  fetch(`/api/customers/${customerId}/memory`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  }).catch(() => {});
}

// Budgets follow the same pattern: Postgres first, localStorage as the fallback copy.
async function fetchServerBudgets(customerId: string): Promise<SavedBudget[] | null> {
  try {
    const res = await fetch(`/api/customers/${customerId}/budgets`);
    if (!res.ok) return null;
    const body = (await res.json()) as { budgets?: unknown[] };
    return (body.budgets ?? []).map(sanitizeSavedBudget).filter((b): b is SavedBudget => b !== null);
  } catch {
    return null;
  }
}

function saveServerBudgets(customerId: string, budgets: SavedBudget[]) {
  if (!budgets.length) return;
  fetch(`/api/customers/${customerId}/budgets`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ budgets }),
  }).catch(() => {});
}

// XP, coins and Locker items: one database row per customer, shared by every device.
// `undefined` means the server can't be reached; `null` means nothing stored yet.
async function fetchServerProgress(
  customerId: string,
): Promise<{ progress: PlayerProgress; at: string } | null | undefined> {
  try {
    const res = await fetch(`/api/customers/${customerId}/progress`);
    if (!res.ok) return undefined;
    const body = (await res.json()) as { progress?: unknown; at?: string };
    const progress = sanitizeProgress(body.progress);
    return progress && body.at ? { progress, at: body.at } : null;
  } catch {
    return undefined;
  }
}

function saveServerProgress(customerId: string, progress: PlayerProgress, at: string) {
  fetch(`/api/customers/${customerId}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ progress, at }),
  }).catch(() => {});
}

interface QuickChip {
  label: string;
  query: string;
}

const QUICK_CHIPS: QuickChip[] = [
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
  const [reloadKey, setReloadKey] = useState(0);
  const [ledgerReady, setLedgerReady] = useState(false);
  const [asking, setAsking] = useState(false);
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
  const [speechOpen, setSpeechOpen] = useState(true);
  /** the full You vs Finland table under Mikko, next to the wall tiles */
  const [boardTable, setBoardTable] = useState(false);
  const [reward, setReward] = useState<{ id: number; text: string } | null>(null);
  const rewardTimer = useRef<number | undefined>(undefined);

  const progress = userState?.progress;
  // The progress object last stored on the server; `ready` once the server copy is in.
  const dialogueAreaRef = useRef<HTMLElement>(null);
  const dialogueRef = useRef<HTMLDivElement>(null);
  const [dialogueScrolls, setDialogueScrolls] = useState(false);
  const choicesRef = useRef<HTMLDivElement>(null);
  const [questCompact, setQuestCompact] = useState(false);
  const progressSync = useRef<{ customerId: string | null; ready: boolean; sent: PlayerProgress | null }>({
    customerId: null,
    ready: false,
    sent: null,
  });

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
        if (!cancel) setLoadError('Could not load your account.');
      });
    return () => {
      cancel = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!customerId) return;
    let cancel = false;
    setLedgerReady(false);
    const local = loadState(customerId);
    setUserState(local);
    setCustomTurn(null);
    setSpeechOpen(true);
    setLevelUpToast(null);
    setReward(null);
    setLockerFeedback(null);
    setOverviewOpen(false);
    setTopicsOpen(false);
    progressSync.current = { customerId, ready: false, sent: null };
    Promise.all([
      fetch(`/api/customers/${customerId}`).then((res) => {
        if (!res.ok) throw new Error('customer');
        return res.json() as Promise<{ transactions: Transaction[] }>;
      }),
      fetchServerMemory(customerId),
      fetchServerBudgets(customerId),
      fetchServerProgress(customerId),
    ])
      .then(([data, serverMemory, serverBudgets, serverProgress]) => {
        if (cancel) return;
        if (serverProgress) {
          // The account row wins, even when this phone has a newer-looking copy.
          const progress = progressFor(customerId, serverProgress.progress);
          progressSync.current = { customerId, ready: true, sent: progress === serverProgress.progress ? progress : null };
          setUserState((prev) =>
            prev && prev.forCustomer === customerId
              ? { ...prev, progress, progressAt: serverProgress.at }
              : prev,
          );
        } else if (serverProgress === null) {
          const progress = progressFor(customerId, local.progress);
          saveServerProgress(customerId, progress, new Date().toISOString());
          progressSync.current = { customerId, ready: true, sent: progress };
          if (progress !== local.progress) {
            setUserState((prev) =>
              prev && prev.forCustomer === customerId ? { ...prev, progress } : prev,
            );
          }
        } else {
          progressSync.current = { customerId, ready: true, sent: local.progress };
        }
        if (serverBudgets) {
          const merged = mergeBudgets(serverBudgets, local.budgets ?? []);
          const onServer = new Map(serverBudgets.map((b) => [b.id, b]));
          saveServerBudgets(
            customerId,
            merged.filter((b) => !onServer.has(b.id) || (b.endedAt && !onServer.get(b.id)!.endedAt)),
          );
          setUserState((prev) =>
            prev && prev.forCustomer === customerId ? { ...prev, budgets: merged } : prev,
          );
        }
        if (serverMemory) {
          const localMemory = (local.memory ?? []).map(sanitizeMemoryEntry).filter((m): m is MikkoMemory => m !== null);
          const merged = mergeMemory(serverMemory, localMemory);
          const serverAt = new Map(serverMemory.map((m) => [m.questId, m.at]));
          saveServerMemory(customerId, merged.filter((m) => (serverAt.get(m.questId) ?? '') < m.at));
          setUserState((prev) =>
            prev && prev.forCustomer === customerId
              ? { ...prev, memory: merged, overrides: withMemoryOverrides(prev.overrides, merged) }
              : prev,
          );
        }
        setTransactions(data.transactions);
        setLedgerReady(true);
      })
      .catch(() => {
        if (!cancel) setLoadError('Could not load your transactions.');
      });
    return () => {
      cancel = true;
    };
  }, [customerId, reloadKey]);

  useEffect(() => {
    const sync = progressSync.current;
    if (!progress || !customerId || !sync.ready || sync.customerId !== customerId) return;
    if (progress === sync.sent) return;
    const at = new Date().toISOString();
    sync.sent = progress;
    saveServerProgress(customerId, progress, at);
    setUserState((prev) => (prev && prev.progress === progress ? { ...prev, progressAt: at } : prev));
  }, [progress, customerId]);

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
        userState?.memory ?? [],
      ),
    [allTxs, userState?.overrides, userState?.resolvedQuestIds, userState?.memory],
  );

  const activeQuest = activeQuests[0] ?? null;

  const moneyMood = useMemo(
    () => computeMoneyMood(visibleTxs, userState?.overrides ?? [], latestMonth),
    [visibleTxs, userState?.overrides, latestMonth],
  );

  const budgets = userState?.budgets ?? [];
  const budget = activeBudget(budgets)?.budget ?? null;
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

  // A new line from Mikko opens the box again, even if it was closed.
  useEffect(() => {
    if (customTurn) setSpeechOpen(true);
  }, [customTurn]);

  // The landing message sits in a fixed area. Scroll only when that message
  // (or a chart under it) is actually taller than the area.
  useEffect(() => {
    const area = dialogueAreaRef.current;
    const dialogue = dialogueRef.current;
    if (!area || !dialogue) {
      setDialogueScrolls(false);
      return;
    }
    const check = () => {
      const style = getComputedStyle(area);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const available = area.clientHeight - padding;
      setDialogueScrolls(dialogue.scrollHeight > available + 1);

      // Quest answers: full rows when they fit under Mikko, tighter rows when they don't.
      const choices = choicesRef.current;
      const parent = area.parentElement;
      if (!choices || !parent) return;
      const n = choices.childElementCount;
      const top = window.matchMedia('(max-height: 520px)').matches ? MESSAGE_TOP_SHORT : MESSAGE_TOP;
      const forChoices = parent.clientHeight - top - padding - (dialogue.scrollHeight - choices.offsetHeight);
      setQuestCompact(n * 44 + (n - 1) * 8 + 4 > forChoices);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(area);
    observer.observe(dialogue);
    return () => observer.disconnect();
  }, [page, customTurn, asking, ledgerReady, speechOpen, activeQuest?.id]);

  if (loadError || !userState || !progress || !ledgerReady || !customerId) {
    const bar = (w: string) => (
      <span className="block h-3 animate-pulse" style={{ width: w, backgroundColor: 'var(--app-surface-muted)' }} />
    );
    return (
      <div className="h-[100dvh] overflow-hidden w-full flex items-center justify-center framed:p-4">
        <div
          data-testid="phone-shell"
          className="relative w-full max-w-[560px] framed:w-[398px] h-[100dvh] framed:h-[812px] framed:max-h-[94vh] flex flex-col overflow-hidden framed:border-[3px]"
          style={{
            backgroundColor: 'var(--app-bg)',
            borderColor: 'var(--app-border)',
          }}
          aria-busy={!loadError}
        >
          <div
            className="min-h-11 px-3 flex items-center justify-between gap-2 border-b-2 shrink-0"
            style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)', paddingTop: 'env(safe-area-inset-top)' }}
          >
            <span className="font-num font-bold text-xs tracking-wider">S-MOBIILI</span>
            {bar('96px')}
          </div>
          <div
            className="px-3 py-2 min-h-[60px] flex flex-col justify-center gap-2 border-b-2 shrink-0"
            style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)' }}
          >
            {bar('128px')}
            {bar('72px')}
          </div>
          <div className="relative flex-1 min-h-0" style={{ backgroundColor: '#6f451f' }}>
          <div className={SCENE_BOX} aria-hidden="true">
            <PixelMentorScene
              mood={loadError ? 'deadpan' : 'pointing'}
              styleId={progress?.equippedStyle ?? 'classic_visor'}
              slipsSharePct={0}
              streakWeeks={0}
              thinking={!loadError}
              variant="background"
            />
          </div>
          <div className="absolute inset-x-0 bottom-0 z-20 px-3 py-2">
            <div className="pixel-card p-3 space-y-2" role="status" data-testid="loading-state">
              <div className="font-num font-bold text-xs tracking-wide">Mikko · Money Coach</div>
              <p className="text-xs leading-relaxed font-medium">
                {loadError
                  ? `${loadError} My notes are out of reach for a moment.`
                  : 'Opening your account… grabbing my notes.'}
              </p>
              {loadError && (
                <button
                  type="button"
                  data-testid="retry-load"
                  onClick={() => {
                    setLoadError(null);
                    setReloadKey((k) => k + 1);
                  }}
                  className="w-full min-h-[44px] px-3 text-xs font-semibold pixel-btn cursor-pointer"
                  style={{ backgroundColor: 'var(--app-accent)', color: 'var(--app-accent-fg)' }}
                >
                  Try again
                </button>
              )}
            </div>
          </div>
          </div>
          <div
            className="p-2 border-t-2 shrink-0 flex gap-2"
            style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)', paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
            aria-hidden="true"
          >
            <span className="block h-11 w-11 animate-pulse" style={{ backgroundColor: 'var(--app-surface-muted)' }} />
            <span className="block h-11 flex-1 animate-pulse" style={{ backgroundColor: 'var(--app-surface-muted)' }} />
          </div>
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

  const showReward = (xp: number, coins: number) => {
    const parts = [xp > 0 ? `+${xp} XP` : '', coins > 0 ? `+${coins} coins` : ''].filter(Boolean);
    if (!parts.length) return;
    window.clearTimeout(rewardTimer.current);
    setReward({ id: Date.now(), text: parts.join(' · ') });
    rewardTimer.current = window.setTimeout(() => setReward(null), 1200);
  };

  const handleSaveBudget = (next: Budget | null) => {
    const firstTime = budgets.length === 0 && next;
    const nextBudgets = saveBudgetVersion(budgets, next, new Date().toISOString(), newId());
    const changed = nextBudgets.filter((b) => !budgets.some((o) => o.id === b.id && o.endedAt === b.endedAt));
    saveServerBudgets(customerId, changed);
    setUserState((prev) => {
      if (!prev) return prev;
      const xp = prev.progress.xp + (firstTime ? 20 : 0);
      return { ...prev, budgets: nextBudgets, progress: { ...prev.progress, xp, level: levelFromXp(xp) } };
    });
    setBudgetOpen(false);
    if (firstTime) showReward(20, 0);
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
    setBoardTable(false);
    setCustomTurn({ mood: 'deadpan', text: 'Pulling the Statistics Finland numbers…' });
    try {
      const [res] = await Promise.all([
        fetch(`/api/customers/${customerId}/compare`),
        new Promise((resolve) => window.setTimeout(resolve, PONDER_MS)),
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
    } catch {
      setCustomTurn({
        mood: 'deadpan',
        text: "Statistics Finland isn't answering me right now. Give it another go in a moment.",
        retry: handleCompareYes,
      });
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
    fetch(`/api/customers/${customerId}/memory`, { method: 'DELETE' }).catch(() => {});
    fetch(`/api/customers/${customerId}/budgets`, { method: 'DELETE' }).catch(() => {});
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

    const remembered = memoryFromQuest({ quest: activeQuest, tx, outcome: 'answered', choiceId });
    saveServerMemory(customerId, [remembered]);
    setUserState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        overrides: res.override
          ? [...prev.overrides, res.override]
          : prev.overrides,
        resolvedQuestIds: [...prev.resolvedQuestIds, activeQuest.id],
        memory: rememberQuest(prev.memory ?? [], remembered),
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

    showReward(res.xpEarned, res.coinsEarned + (leveledUp ? 35 : 0));
    if (leveledUp) {
      setLevelUpToast(`Level ${nextLevel} unlocked (+35 Bonus Coins)`);
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
            budget,
            budgets,
            history: userState.chat ?? [],
            // the server reads Postgres; this copy is only used when that's unavailable
            memory: userState.memory ?? [],
          }),
        }),
        new Promise((resolve) => window.setTimeout(resolve, PONDER_MS)),
      ]);
      const answer = await res.json();
      if (!res.ok) throw new Error(answer.error || 'Chat failed');
      setUserState((prev) =>
        prev
          ? {
              ...prev,
              chat: [
                ...(prev.chat ?? []),
                { role: 'user' as const, text: trimmed },
                { role: 'mentor' as const, text: answer.text },
              ].slice(-CHAT_KEEP),
            }
          : prev,
      );
      setCustomTurn({
        mood: answer.chart ? 'pointing' : answer.mood,
        text: answer.text,
        chart: answer.chart,
      });
    } catch {
      setCustomTurn({
        mood: 'deadpan',
        text: "I couldn't reach my notes just now. Your question wasn't lost, try it again.",
        retry: () => handleSendQuery(trimmed),
      });
    } finally {
      setAsking(false);
    }
  };

  const handleChip = (chip: QuickChip) => {
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
  };

  // Three prompts that fit the moment, first and highlighted in the quick prompts menu.
  const suggestedChips = (() => {
    const pick = (label: string) => QUICK_CHIPS.find((c) => c.label === label)!;
    const first =
      moneyMood.level !== 'happy'
        ? pick('How am I doing?')
        : budgetStatus?.worst
          ? pick('Can I buy it?')
          : pick('Safe this week?');
    const second = seasonAhead ? pick('Seasons') : pick('Emergency fund');
    const third = customTurn?.chart?.kind === 'finland_board' ? pick('Taxis?') : pick('Compare peers');
    return [first, second, third];
  })();

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
    showReward(25, 15);
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
    <div className="h-[100dvh] overflow-hidden w-full flex items-center justify-center framed:p-4">
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
          <header
            className="min-h-11 px-3 flex items-center justify-between gap-2 border-b-2 shrink-0"
            style={{
              paddingTop: 'env(safe-area-inset-top)',
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
                    key={reward?.id ?? 'xp'}
                    className={`w-20 h-3 overflow-hidden ${reward ? 'xp-pulse' : ''}`}
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
                  <span className="font-num text-xs font-semibold text-[var(--app-text-muted)] whitespace-nowrap">
                    {xpInfo.currentInLevel}/{xpInfo.neededForNext} · {progress.coins}c
                  </span>
                </div>
              );
            })()}
          </header>

          <div
            className="px-3 py-2 flex items-center justify-between gap-2 border-b-2 shrink-0"
            style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)' }}
            data-testid="account-balance"
          >
            <div className="flex items-baseline gap-2 min-w-0">
              <span
                className="font-num text-xl font-bold shrink-0"
                style={{ color: accountBalance < 0 ? 'var(--app-danger)' : 'var(--app-text)' }}
              >
                {accountBalance < 0 ? '−' : ''}€{Math.abs(accountBalance).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-xs text-[var(--app-text-muted)] truncate">
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
                className="min-h-[44px] px-3 flex items-center gap-2 text-xs font-semibold cursor-pointer shrink-0 border border-[var(--app-border)]"
                style={{ backgroundColor: overviewOpen ? 'var(--app-bg)' : 'var(--app-surface-muted)' }}
              >
                <span className="flex items-center gap-1" aria-hidden="true">
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
                <div
                  className="px-2 py-1 flex items-center justify-between gap-2 border-b-2"
                  style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)' }}
                >
                  <span className="font-num text-xs font-bold uppercase tracking-wide">Overview</span>
                  <button
                    type="button"
                    onClick={() => setOverviewOpen(false)}
                    aria-label="Close overview"
                    className="touch-x"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <BasketsMeter
                  baskets={baskets}
                  monthKey={latestMonth}
                  lastShiftedBasket={lastShiftedBasket}
                />

                <button
                  type="button"
                  data-testid="open-seasons"
                  onClick={() => {
                    setOverviewOpen(false);
                    handleShowSeasons();
                  }}
                  className="w-full min-h-[44px] px-3 flex items-center justify-between gap-2 text-xs font-semibold border-b-2 cursor-pointer"
                  style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)' }}
                >
                  <span>Seasons{seasonAhead ? `: ${seasonAhead.title}` : ''}</span>
                  <ChevronRight className="w-4 h-4 shrink-0" />
                </button>
                <label
                  htmlFor="customer-picker"
                  data-testid="test-bar"
                  className="min-h-[44px] px-3 flex items-center justify-between gap-2 border-b-2 text-xs"
                  style={{ backgroundColor: 'var(--app-surface-muted)', borderColor: 'var(--app-border)' }}
                >
                  <span className="font-num uppercase tracking-wider text-[var(--app-text-muted)] font-semibold">
                    Test profile
                  </span>
                  <select
                    id="customer-picker"
                    value={customerId}
                    onChange={(e) => {
                      setLedgerReady(false);
                      setCustomerId(e.target.value);
                      const url = new URL(window.location.href);
                      url.searchParams.set('customer', e.target.value);
                      window.history.replaceState(null, '', url);
                    }}
                    className="min-h-[36px] px-2 font-num text-base font-semibold bg-[var(--app-bg)] border border-[var(--app-border)] cursor-pointer"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.id.replace('CUST', '')} · {c.age}y
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {/* The room is drawn at a fixed height and never resizes, so Mikko keeps one size.
                Messages and charts float over the floor below him, and over him when they need the space. */}
            <div
              data-testid="mikko-room"
              className="absolute inset-0"
              style={{ backgroundColor: '#6f451f' }}
            >
              <div className={SCENE_BOX} aria-hidden="true">
                <PixelMentorScene
                  mood={activeMood}
                  styleId={progress.equippedStyle}
                  slipsSharePct={slipsSharePct}
                  streakWeeks={progress.streakWeeks}
                  thinking={asking || !speechOpen}
                  hasQuestion={(!customTurn && Boolean(activeQuest)) || Boolean(customTurn?.offerCompare)}
                  variant="background"
                />
              </div>
              {!(speechOpen && customTurn?.chart?.kind === 'finland_board') && (() => {
                const worst = budgetStatus?.worst ?? null;
                const limit = budgetStatus?.lines.reduce((s, l) => s + l.limit, 0) ?? 0;
                const spent = budgetStatus?.lines.reduce((s, l) => s + l.spent, 0) ?? 0;
                const budgetColor = worst?.status === 'over' ? 'var(--app-danger)' : worst ? '#b45309' : 'var(--app-border)';
                const budgetText = !budgetStatus || !limit
                  ? 'Set budget'
                  : worst?.status === 'over'
                    ? 'Over budget'
                    : worst
                      ? `€${Math.max(0, worst.left).toFixed(0)} left`
                      : `${Math.round((spent / limit) * 100)}% used`;
                const ef = moneyMood.emergency;
                const pill = 'min-h-[44px] px-2 flex items-center gap-1 min-w-0 text-xs font-semibold cursor-pointer border-2';
                return (
                  <div
                    data-testid="status-strip"
                    className="absolute top-2 left-2 right-2 z-20 grid grid-cols-3 gap-2"
                  >
                    <button
                      type="button"
                      data-testid="money-mood"
                      onClick={handleShowMood}
                      className={pill}
                      style={{ backgroundColor: 'var(--app-surface)', borderColor: MOOD_COLOR[moneyMood.level] }}
                      aria-label={`Money mood: ${MOOD_LABEL[moneyMood.level]}, score ${moneyMood.score} of 100. Tap for details.`}
                    >
                      <span
                        className="w-4 h-4 shrink-0 grid place-items-center text-xs font-bold text-white"
                        style={{ backgroundColor: MOOD_COLOR[moneyMood.level] }}
                        aria-hidden="true"
                      >
                        {moneyMood.level === 'happy' ? '✓' : moneyMood.level === 'mild' ? '–' : '!'}
                      </span>
                      <span className="truncate">Mood</span>
                      <span className="font-num ml-auto shrink-0">{moneyMood.score}</span>
                    </button>
                    <button
                      type="button"
                      data-testid="emergency-fund"
                      onClick={handleShowEmergencyFund}
                      className={`${pill} flex-col !items-stretch justify-center !gap-1`}
                      style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)' }}
                      aria-label={`Emergency fund ${ef.monthsCovered.toFixed(1)} of ${ef.goalMonths} months. Tap for details.`}
                    >
                      <span className="flex items-center justify-between gap-1">
                        <span className="truncate">Fund</span>
                        <span className="font-num shrink-0">
                          {Math.min(99, ef.monthsCovered).toFixed(1)}/{ef.goalMonths}
                        </span>
                      </span>
                      <span className="block h-1" style={{ backgroundColor: 'var(--app-surface-muted)' }} aria-hidden="true">
                        <span
                          className="block h-full"
                          style={{ width: `${ef.progressPct}%`, backgroundColor: EF_COLOR[ef.status] }}
                        />
                      </span>
                    </button>
                    <button
                      type="button"
                      data-testid="budget-bar"
                      data-status={worst?.status ?? (budgetStatus ? 'ok' : 'none')}
                      onClick={() => setBudgetOpen(true)}
                      className={pill}
                      style={{
                        backgroundColor: worst?.status === 'over' ? 'var(--app-danger)' : 'var(--app-surface)',
                        color: worst?.status === 'over' ? '#ffffff' : 'var(--app-text)',
                        borderColor: budgetColor,
                      }}
                      aria-label={budgetStatus ? `Budget: ${budgetText}. Tap to edit or check a purchase.` : 'Set a monthly budget'}
                    >
                      <span className="truncate">{budgetText}</span>
                      <ChevronRight className="w-4 h-4 shrink-0 ml-auto" />
                    </button>
                  </div>
                );
              })()}
              {speechOpen && customTurn?.chart?.kind === 'finland_board' && (
                <div className={`${SCENE_BOX} z-10 pointer-events-none`}>
                <FinlandWall
                  board={customTurn.chart}
                  picked={customTurn.pick}
                  onPick={handlePickCategory}
                  onSeasons={handleShowSeasons}
                  onShowAll={() => setBoardTable((v) => !v)}
                  tableOpen={boardTable}
                  onClose={() => {
                    setCustomTurn(null);
                  }}
                />
                </div>
              )}
              {reward && (
                <div className={`${SCENE_BOX} z-20 pointer-events-none`}>
                <div
                  key={reward.id}
                  data-testid="reward-float"
                  role="status"
                  className="reward-float absolute left-1/2 top-[40%] z-20 px-3 py-1 font-num text-sm font-bold whitespace-nowrap border-2 pointer-events-none"
                  style={{
                    backgroundColor: 'var(--app-accent)',
                    color: 'var(--app-accent-fg)',
                    borderColor: 'var(--app-border)',
                    boxShadow: 'var(--pixel-shadow)',
                  }}
                >
                  {reward.text}
                </div>
                </div>
              )}
              {!speechOpen && (
                <button
                  type="button"
                  data-testid="mikko-reopen"
                  className="absolute inset-0 z-10 cursor-pointer"
                  aria-label="Show Mikko's message"
                  onClick={() => setSpeechOpen(true)}
                />
              )}
            </div>

            <main
              ref={dialogueAreaRef}
              className={`absolute inset-x-0 bottom-0 z-20 px-3 pt-2 pb-2 flex flex-col ${
                customTurn?.chart ? 'max-h-[calc(100%-56px)]' : 'max-h-[calc(100%-248px)] short:max-h-[calc(100%-112px)]'
              } ${dialogueScrolls ? 'overflow-y-auto' : 'overflow-hidden'}`}
            >
              <div ref={dialogueRef} className="min-h-0 flex flex-col gap-2 [&>*]:shrink-0 [&>section]:shrink">
              {levelUpToast && (
                <div
                  data-testid="level-up-banner"
                  className="px-3 py-1 text-xs font-semibold flex items-center justify-between gap-2 border-2"
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
              {speechOpen && (customTurn?.chart ? (
                <div className="space-y-2">
                  <div
                    data-testid="mentor-speech"
                    className="pixel-card px-3 py-2 text-xs leading-snug font-medium flex items-start justify-between gap-2"
                  >
                    <span>
                      <strong className="font-num">Mikko:</strong> {activeSpeech}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSpeechOpen(false)}
                      aria-label="Close"
                      className="touch-x"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className={customTurn.chart.kind === 'finland_board' && !boardTable ? 'hidden short:block' : ''}>
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
                  className={`pixel-card p-3 flex flex-col gap-2 [&>*]:shrink-0 ${
                    !customTurn && activeQuest ? 'min-h-0 [&>[data-testid=suspicion-quest]]:shrink' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p
                      data-testid="mentor-speech"
                      className="text-xs leading-relaxed font-medium min-w-0"
                    >
                      <strong className="font-num">Mikko:</strong>{' '}
                      {asking ? 'Grabbing my notes… checking your numbers.' : activeSpeech}
                    </p>
                    <button
                      type="button"
                      onClick={() => setSpeechOpen(false)}
                      aria-label="Close"
                      className="touch-x"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                {customTurn?.retry && !asking && (
                  <button
                    type="button"
                    data-testid="retry-turn"
                    onClick={customTurn.retry}
                    className="w-full min-h-[44px] px-3 text-xs font-semibold pixel-btn cursor-pointer"
                    style={{ backgroundColor: 'var(--app-accent)', color: 'var(--app-accent-fg)' }}
                  >
                    Try again
                  </button>
                )}

                {customTurn?.offerWhatIf && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleOpenOfferedChart}
                      className="min-h-[44px] px-3 text-xs font-semibold pixel-btn cursor-pointer flex items-center justify-center gap-1"
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
                      className="min-h-[44px] px-3 text-xs font-semibold pixel-btn cursor-pointer"
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
                      className="min-h-[44px] px-3 text-xs font-semibold pixel-btn cursor-pointer flex items-center justify-center gap-1"
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
                      className="min-h-[44px] px-3 text-xs font-semibold pixel-btn cursor-pointer"
                      style={{ backgroundColor: 'var(--app-surface-muted)', color: 'var(--app-text)' }}
                    >
                      {activeQuest ? 'Check Spend (+XP)' : 'Ask a Question'}
                    </button>
                  </div>
                )}

                {!customTurn && activeQuest && (
                  <div data-testid="suspicion-quest" className="min-h-0 flex flex-col">
                    <div
                      ref={choicesRef}
                      className={`min-h-0 overflow-y-auto overscroll-contain pr-1 pb-1 ${questCompact ? 'space-y-1' : 'space-y-2'}`}
                      data-testid="quest-choices"
                      data-compact={questCompact ? 'true' : 'false'}
                    >
                      {activeQuest.choices.map((ch) => (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => handleAnswerQuest(ch.id)}
                          className={`w-full px-3 text-left text-xs font-semibold pixel-btn flex items-center justify-between gap-2 cursor-pointer ${
                            questCompact ? 'min-h-[30px] py-1' : 'min-h-[44px] py-2'
                          }`}
                          style={{
                            backgroundColor: 'var(--app-surface-muted)',
                            color: 'var(--app-text)',
                          }}
                        >
                          <span>{ch.label}</span>
                          <span className="font-num text-xs text-[var(--app-text-muted)] shrink-0">
                            {ch.xp > 0 ? `+${ch.xp} XP` : 'Claim'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              </section>
            ))}
              </div>
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
                className="absolute left-2 right-2 bottom-full mb-2 pixel-card p-3 space-y-2 z-20"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-num text-xs font-bold uppercase tracking-wide">
                    Quick prompts
                  </span>
                  <button
                    type="button"
                    onClick={() => setTopicsOpen(false)}
                    aria-label="Close quick prompts"
                    className="touch-x"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[...suggestedChips, ...QUICK_CHIPS.filter((c) => !suggestedChips.includes(c))].map((chip) => {
                    const suggested = suggestedChips.includes(chip);
                    return (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => handleChip(chip)}
                        disabled={asking}
                        data-suggested={suggested ? 'true' : undefined}
                        className="min-h-[44px] px-3 py-2 text-left text-xs font-semibold pixel-btn cursor-pointer truncate"
                        style={{
                          backgroundColor: suggested ? 'var(--app-surface)' : 'var(--app-surface-muted)',
                          borderColor: suggested ? 'var(--app-accent)' : undefined,
                          color: 'var(--app-text)',
                        }}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendQuery(chatInput);
              }}
              className="flex gap-2"
            >
              <button
                type="button"
                data-testid="topics-toggle"
                onClick={() => setTopicsOpen((o) => !o)}
                aria-expanded={topicsOpen}
                aria-label="More quick prompts"
                disabled={asking}
                className="min-h-[44px] min-w-[44px] px-3 flex items-center justify-center pixel-btn cursor-pointer shrink-0"
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
                enterKeyHint="send"
                className="flex-1 min-w-0 min-h-[44px] px-3 text-base border-2 bg-[var(--app-bg)] border-[var(--app-border)] focus:outline-none focus:border-[var(--app-accent)]"
              />
              <button
                type="submit"
                disabled={asking}
                className="min-h-[44px] px-4 text-xs font-semibold pixel-btn cursor-pointer whitespace-nowrap"
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
            history={budgets}
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

