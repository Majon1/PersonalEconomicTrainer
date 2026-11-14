// The pages under the bottom navigation: Spending, Money in, and Home.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Gamepad2, House, Menu, ShoppingBag, Wallet } from 'lucide-react';
import { isNonSpending, resolveTxBasket } from '../game/engine';
import type { BasketKey, LabelOverride, Transaction } from '../game/types';

export type PageKey = 'mikko' | 'spending' | 'money_in' | 'home';

const eur = (v: number, digits = 0) =>
  `€${v.toLocaleString('en-IE', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const monthName = (m: string, style: 'long' | 'short' = 'long') =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: style, year: 'numeric', timeZone: 'UTC' });
const dayName = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const months = (txs: Transaction[]) => [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort();

const BASKET_COLOR: Record<BasketKey, string> = {
  mandatory_regular: '#007a45',
  mandatory_irregular: '#2563eb',
  slips: '#c25e00',
  nice_to_have: '#7c3aed',
};
const BASKET_LABEL: Record<BasketKey, string> = {
  mandatory_regular: 'Regular',
  mandatory_irregular: 'Irregular',
  slips: 'Slip',
  nice_to_have: 'Nice',
};

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-2">
      <h2 className="font-num text-sm font-bold uppercase tracking-wide">{title}</h2>
      {subtitle && <p className="text-xs text-[var(--app-text-muted)]">{subtitle}</p>}
    </div>
  );
}

function MonthPicker({ value, options, onChange }: { value: string; options: string[]; onChange: (m: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs font-semibold mb-2">
      <span>Month</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[36px] px-2 text-sm border-2 border-[var(--app-border)] bg-[var(--app-bg)]"
      >
        {[...options].reverse().map((m) => (
          <option key={m} value={m}>{monthName(m)}</option>
        ))}
      </select>
    </label>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="p-2" style={{ backgroundColor: 'var(--app-surface-muted)', border: '1px solid var(--app-border)' }}>
      <div className="text-[11px] text-[var(--app-text-muted)]">{label}</div>
      <div className="font-num text-sm font-bold">{value}</div>
      {note && <div className="text-[10px] text-[var(--app-text-muted)] leading-tight mt-0.5">{note}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spending: the ten categories, per month
// ---------------------------------------------------------------------------

export function SpendingPage({ transactions, overrides }: { transactions: Transaction[]; overrides: LabelOverride[] }) {
  const all = months(transactions);
  const [month, setMonth] = useState(all[all.length - 1]);
  const [open, setOpen] = useState<string | null>(null);

  const { rows, total } = useMemo(() => {
    const spend = transactions.filter((t) => t.date.startsWith(month) && t.amount < 0 && !isNonSpending(t));
    const by = new Map<string, { category: string; total: number; txs: Transaction[]; baskets: Record<string, number> }>();
    for (const t of spend) {
      const e = by.get(t.category) ?? { category: t.category, total: 0, txs: [], baskets: {} };
      const b = resolveTxBasket(t, overrides).basket;
      e.total += Math.abs(t.amount);
      e.txs.push(t);
      e.baskets[b] = (e.baskets[b] || 0) + Math.abs(t.amount);
      by.set(t.category, e);
    }
    const rows = [...by.values()].sort((a, b) => b.total - a.total);
    return { rows, total: rows.reduce((a, r) => a + r.total, 0) };
  }, [transactions, overrides, month]);
  const max = rows[0]?.total || 1;

  return (
    <div className="p-3 space-y-2" data-testid="page-spending">
      <PageHeader title="Spending" subtitle={`${eur(total)} spent in ${monthName(month)}. Tap a category to see the purchases.`} />
      <MonthPicker value={month} options={all} onChange={(m) => { setMonth(m); setOpen(null); }} />
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const main = (Object.entries(r.baskets).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'slips') as BasketKey;
          const isOpen = open === r.category;
          return (
            <li key={r.category} className="pixel-card">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : r.category)}
                aria-expanded={isOpen}
                className="w-full p-2.5 text-left cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2.5 h-2.5 shrink-0" style={{ backgroundColor: BASKET_COLOR[main] }} aria-hidden="true" />
                    <span className="font-semibold truncate">{r.category}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="font-num font-bold">{eur(r.total)}</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5" style={{ backgroundColor: 'var(--app-surface-muted)' }}>
                    <div className="h-full" style={{ width: `${(r.total / max) * 100}%`, backgroundColor: BASKET_COLOR[main] }} />
                  </div>
                  <span className="text-[11px] text-[var(--app-text-muted)] shrink-0">
                    {r.txs.length} purchase{r.txs.length === 1 ? '' : 's'} · {Math.round((r.total / (total || 1)) * 100)}%
                  </span>
                </div>
              </button>
              {isOpen && (
                <ul className="border-t px-2.5 pb-2" style={{ borderColor: 'var(--app-border)' }}>
                  {[...r.txs].reverse().map((t) => {
                    const b = resolveTxBasket(t, overrides).basket;
                    return (
                      <li key={t.id} className="flex items-center justify-between gap-2 py-1 text-xs border-b last:border-b-0" style={{ borderColor: 'var(--app-border)' }}>
                        <span className="font-num text-[var(--app-text-muted)] w-12 shrink-0">{dayName(t.date)}</span>
                        <span className="flex-1 min-w-0 truncate">{t.merchantType || t.category}</span>
                        <span className="text-[10px] px-1 shrink-0" style={{ color: BASKET_COLOR[b], border: `1px solid ${BASKET_COLOR[b]}` }}>
                          {BASKET_LABEL[b]}
                        </span>
                        <span className="font-num font-semibold w-16 text-right shrink-0">{eur(Math.abs(t.amount), 2)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
        {!rows.length && <li className="text-sm text-[var(--app-text-muted)]">No spending this month.</li>}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money in: salary, other income, investments, salary sweeps
// ---------------------------------------------------------------------------

const FLOW = [
  { key: 'salary', label: 'Salary', match: (t: Transaction) => t.type === 'salary' || t.category === 'Salary', sign: 1 },
  { key: 'other_income', label: 'Other income', match: (t: Transaction) => t.type === 'other_income' || t.category === 'Other Income', sign: 1 },
  { key: 'investment_withdrawal', label: 'Taken from investments', match: (t: Transaction) => t.type === 'investment_withdrawal' || t.category === 'Invest Withdraw', sign: 1 },
  { key: 'investment_deposit', label: 'Moved to investments', match: (t: Transaction) => t.type === 'investment_deposit' || t.category === 'Invest Deposit', sign: -1 },
  { key: 'salary_sweep', label: 'Salary sweep (to savings)', match: (t: Transaction) => t.type === 'salary_sweep' || t.category === 'Salary Sweep', sign: -1 },
] as const;

export function MoneyInPage({ transactions }: { transactions: Transaction[] }) {
  const all = months(transactions);
  const [month, setMonth] = useState(all[all.length - 1]);
  const flowOf = (t: Transaction) => FLOW.find((f) => f.match(t));
  const last12 = all.slice(-12);

  const sums = (m: string) =>
    Object.fromEntries(
      FLOW.map((f) => [f.key, transactions.filter((t) => t.date.startsWith(m) && f.match(t)).reduce((a, t) => a + Math.abs(t.amount), 0)]),
    ) as Record<(typeof FLOW)[number]['key'], number>;
  const now = sums(month);
  const avg = (k: (typeof FLOW)[number]['key']) => last12.reduce((a, m) => a + sums(m)[k], 0) / Math.max(1, last12.length);
  const investedSoFar = transactions.reduce(
    (a, t) => a + (t.type === 'investment_deposit' ? Math.abs(t.amount) : t.type === 'investment_withdrawal' ? -Math.abs(t.amount) : 0),
    0,
  );
  const incomeSeries = last12.map((m) => ({ m, v: sums(m).salary + sums(m).other_income }));
  const maxIncome = Math.max(1, ...incomeSeries.map((s) => s.v));
  const rows = transactions.filter((t) => t.date.startsWith(month) && flowOf(t)).reverse();

  return (
    <div className="p-3 space-y-3" data-testid="page-money-in">
      <PageHeader title="Money in & set aside" subtitle="Salary and other income, and money you moved to investments or savings." />
      <MonthPicker value={month} options={all} onChange={setMonth} />
      <div className="grid grid-cols-2 gap-1.5">
        {FLOW.map((f) => (
          <Stat key={f.key} label={f.label} value={eur(now[f.key])} note={`12-month avg ${eur(avg(f.key))}`} />
        ))}
        <Stat label="Invested so far" value={eur(Math.max(0, investedSoFar))} note="Deposits minus withdrawals" />
      </div>

      <section className="pixel-card p-3">
        <h3 className="text-xs font-semibold mb-2">Income per month (salary + other)</h3>
        <div className="flex items-end gap-1 h-20" role="img" aria-label="Income for the last 12 months">
          {incomeSeries.map((s) => (
            <div key={s.m} className="flex-1 flex flex-col items-center gap-0.5 h-full justify-end">
              <div
                className="w-full"
                title={`${monthName(s.m, 'short')}: ${eur(s.v)}`}
                style={{ height: `${(s.v / maxIncome) * 100}%`, backgroundColor: s.m === month ? 'var(--app-accent)' : 'var(--app-text-muted)', opacity: s.m === month ? 1 : 0.5 }}
              />
              <span className="font-num text-[9px] text-[var(--app-text-muted)]">{monthName(s.m, 'short').slice(0, 1)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="pixel-card p-3">
        <h3 className="text-xs font-semibold mb-1">{monthName(month)}</h3>
        <ul>
          {rows.map((t) => {
            const f = flowOf(t)!;
            return (
              <li key={t.id} className="flex items-center justify-between gap-2 py-1 text-xs border-b last:border-b-0" style={{ borderColor: 'var(--app-border)' }}>
                <span className="font-num text-[var(--app-text-muted)] w-12 shrink-0">{dayName(t.date)}</span>
                <span className="flex-1 min-w-0 truncate">{f.label}</span>
                <span className="font-num font-semibold shrink-0" style={{ color: f.sign > 0 ? 'var(--app-accent)' : 'var(--app-text)' }}>
                  {f.sign > 0 ? '+' : '−'}{eur(Math.abs(t.amount), 2)}
                </span>
              </li>
            );
          })}
          {!rows.length && <li className="text-xs text-[var(--app-text-muted)]">Nothing this month.</li>}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home: the mortgage application and its extra costs
// ---------------------------------------------------------------------------

interface MortgageApplication {
  id: string;
  decision: string;
  rejectionReason: string | null;
  propertyPrice: number;
  loan: number;
  equity: number;
  collateralValue: number;
  requiredMonthlyIncome: number;
  loanToValue: number;
  startedOn: string | null;
  decidedOn: string | null;
  propertiesViewed: number;
  propertyTypes: string[];
  contacts: number;
  steps: number;
  expenses: { date: string | null; type: string; amount: number }[];
}
interface MortgageStats {
  applications: number;
  approved: number;
  medianPrice: number;
  medianLoan: number;
  medianEquity: number;
  medianRequiredIncome: number;
  rejectionReasons: { reason: string; n: number }[];
  typicalCosts: { type: string; count: number; average: number }[];
}

const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function HomePage({ customerId, transactions }: { customerId: string; transactions: Transaction[] }) {
  const [data, setData] = useState<{ application: MortgageApplication | null; stats: MortgageStats } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setData(null);
    fetch(`/api/customers/${customerId}/mortgage`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('mortgage'))))
      .then((d) => !cancel && setData(d))
      .catch(() => !cancel && setError('Could not load the mortgage data.'));
    return () => {
      cancel = true;
    };
  }, [customerId]);

  // Average monthly income over the last 12 months, to set against what the bank requires.
  const avgIncome = useMemo(() => {
    const ms = months(transactions).slice(-12);
    const inc = transactions.filter((t) => ms.includes(t.date.slice(0, 7)) && t.amount > 0 && (t.type === 'salary' || t.type === 'other_income'));
    return inc.reduce((a, t) => a + t.amount, 0) / Math.max(1, ms.length);
  }, [transactions]);
  const balance = useMemo(() => {
    const sorted = [...transactions].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    return sorted[sorted.length - 1]?.balanceAfter ?? 0;
  }, [transactions]);

  if (error) return <p className="p-3 text-sm">{error}</p>;
  if (!data) return <p className="p-3 text-sm">Loading…</p>;
  const { application: a, stats: s } = data;
  const approvalPct = Math.round((s.approved / Math.max(1, s.applications)) * 100);

  return (
    <div className="p-3 space-y-3" data-testid="page-home">
      <PageHeader title="Home & mortgage" subtitle={a ? `Your application ${a.id}` : 'No home loan application yet'} />

      {a ? (
        <>
          <section className="pixel-card p-3 space-y-2">
            <div
              className="px-2 py-1.5 text-sm font-bold flex items-center justify-between"
              style={{ backgroundColor: a.decision === 'approved' ? '#15803d' : '#b91c1c', color: '#fff' }}
            >
              <span>{a.decision === 'approved' ? '✓ Approved' : '✕ Rejected'}</span>
              {a.rejectionReason && <span className="text-xs font-semibold">{pretty(a.rejectionReason)}</span>}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Stat label="Property price" value={eur(a.propertyPrice)} />
              <Stat label="Loan" value={eur(a.loan)} />
              <Stat label="Own savings put in" value={eur(a.equity)} note={`${Math.round((a.equity / a.propertyPrice) * 100)}% of the price`} />
              <Stat label="Collateral value" value={eur(a.collateralValue)} note="What the bank values the security at" />
              <Stat
                label="Required monthly income"
                value={eur(a.requiredMonthlyIncome)}
                note={`Your average: ${eur(avgIncome)} (${Math.round((avgIncome / a.requiredMonthlyIncome) * 100)}%)`}
              />
              <Stat label="Loan-to-value" value={`${Math.round(a.loanToValue * 100)}%`} note="Loan as a share of the collateral value" />
            </div>
            <p className="text-[11px] text-[var(--app-text-muted)]">
              {a.startedOn && a.decidedOn ? `Applied ${dayName(a.startedOn)} → decided ${dayName(a.decidedOn)} 2026. ` : ''}
              {a.propertiesViewed} home{a.propertiesViewed === 1 ? '' : 's'} considered
              {a.propertyTypes.length ? ` (${a.propertyTypes.map(pretty).join(', ').toLowerCase()})` : ''}, {a.contacts} contacts with the bank, {a.steps} steps in all.
            </p>
          </section>

          <section className="pixel-card p-3">
            <h3 className="text-xs font-semibold mb-1">Extra costs along the way</h3>
            <ul>
              {a.expenses.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1 text-xs border-b last:border-b-0" style={{ borderColor: 'var(--app-border)' }}>
                  <span className="font-num text-[var(--app-text-muted)] w-12 shrink-0">{e.date ? dayName(e.date) : ''}</span>
                  <span className="flex-1">{pretty(e.type)}</span>
                  <span className="font-num font-semibold">{eur(e.amount)}</span>
                </li>
              ))}
              {!a.expenses.length && <li className="text-xs text-[var(--app-text-muted)]">None recorded.</li>}
            </ul>
            {a.expenses.length > 0 && (
              <div className="flex justify-between text-xs font-bold pt-1.5 mt-1 border-t" style={{ borderColor: 'var(--app-border)' }}>
                <span>Total extra</span>
                <span className="font-num">{eur(a.expenses.reduce((x, e) => x + e.amount, 0))}</span>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="pixel-card p-3 space-y-2">
          <p className="text-xs">
            You haven't applied for a home loan. Here's how you compare with what applicants in this bank typically had:
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="Your monthly income" value={eur(avgIncome)} note={`Typical required: ${eur(s.medianRequiredIncome)}`} />
            <Stat label="On your account" value={eur(balance)} note={`Typical own savings put in: ${eur(s.medianEquity)}`} />
          </div>
        </section>
      )}

      <section className="pixel-card p-3 space-y-2">
        <h3 className="text-xs font-semibold">How the bank's {s.applications} home loan applications went</h3>
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Approved" value={`${approvalPct}%`} note={`${s.approved} of ${s.applications}`} />
          <Stat label="Typical price" value={eur(s.medianPrice)} />
          <Stat label="Typical loan" value={eur(s.medianLoan)} />
          <Stat label="Typical own savings" value={eur(s.medianEquity)} />
        </div>
        <div>
          <h4 className="text-[11px] font-semibold mt-1">Why applications were rejected</h4>
          <ul className="text-xs">
            {s.rejectionReasons.map((r) => (
              <li key={r.reason} className="flex justify-between py-0.5">
                <span>{pretty(r.reason)}</span>
                <span className="font-num">{r.n}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-[11px] font-semibold mt-1">Typical extra costs (average when they came up)</h4>
          <ul className="text-xs">
            {s.typicalCosts.map((c) => (
              <li key={c.type} className="flex justify-between py-0.5">
                <span>{pretty(c.type)}</span>
                <span className="font-num">{eur(c.average)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page menu: one button that opens the list of pages
// ---------------------------------------------------------------------------

export const PAGES: { key: PageKey; label: string; icon: typeof House }[] = [
  { key: 'mikko', label: 'Mikko', icon: Gamepad2 },
  { key: 'spending', label: 'Spending', icon: ShoppingBag },
  { key: 'money_in', label: 'Money in', icon: Wallet },
  { key: 'home', label: 'Home', icon: House },
];

export function PageMenu({ page, onChange }: { page: PageKey; onChange: (p: PageKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = PAGES.find((p) => p.key === page) ?? PAGES[0];
  const CurrentIcon = current.icon;

  // Close on a tap outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Page: ${current.label}. Choose a page.`}
        data-testid="page-menu"
        className="h-9 pl-2 pr-1.5 flex items-center gap-1 text-xs font-semibold pixel-btn cursor-pointer"
        style={{ backgroundColor: 'var(--app-surface-muted)', color: 'var(--app-text)' }}
      >
        <Menu className="w-4 h-4" aria-hidden="true" />
        <CurrentIcon className="w-4 h-4 max-[339px]:hidden" aria-hidden="true" />
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <ul
          role="menu"
          aria-label="Pages"
          className="absolute left-0 top-full mt-1 z-50 min-w-[180px] pixel-card py-1"
        >
          {PAGES.map(({ key, label, icon: Icon }) => {
            const on = key === page;
            return (
              <li key={key} role="none">
                <button
                  type="button"
                  role="menuitem"
                  aria-current={on ? 'page' : undefined}
                  onClick={() => {
                    setOpen(false);
                    onChange(key);
                  }}
                  className="w-full min-h-[44px] px-3 flex items-center gap-2.5 text-sm font-semibold text-left cursor-pointer hover:bg-[var(--app-surface-muted)]"
                  style={{ color: on ? 'var(--app-accent)' : 'var(--app-text)' }}
                >
                  <Icon className="w-5 h-5" aria-hidden="true" />
                  <span className="flex-1">{label}</span>
                  {on && <Check className="w-4 h-4" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
