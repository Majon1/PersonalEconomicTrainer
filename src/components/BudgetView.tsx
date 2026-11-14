import { useState } from 'react';
import { X } from 'lucide-react';
import { BUDGET_CATEGORIES } from '../game/engine';
import type { Budget, BudgetStatus, SavedBudget } from '../game/types';

interface BudgetViewProps {
  budget: Budget | null;
  /** every budget they made, active and ended */
  history: SavedBudget[];
  suggestion: Budget;
  status: BudgetStatus | null;
  onSave: (budget: Budget | null) => void;
  onCheckPurchase: (amount: number, category: string, what: string) => void;
  onClose: () => void;
}

const STATUS_COLOR = { ok: 'var(--app-accent)', close: '#d97706', over: 'var(--app-danger)' } as const;
const STATUS_LABEL = { ok: 'On track', close: 'Careful', over: 'Over' } as const;

// What you might be about to buy, mapped to the bank's categories.
const PURCHASE_KINDS = [
  { category: 'Restaurants', label: 'Café / eating out' },
  { category: 'Taxi', label: 'Taxi' },
  { category: 'Lifestyle', label: 'Clothes / shopping' },
  { category: 'Entertainment', label: 'Event / hobby' },
  { category: 'Travel', label: 'Trip / travel' },
  { category: 'Home & Tech', label: 'Home / tech' },
  { category: 'Groceries', label: 'Groceries' },
];

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function limitsText(b: Budget) {
  return [
    b.slips ? `Slips €${b.slips}` : '',
    b.nice_to_have ? `Nice to have €${b.nice_to_have}` : '',
    ...Object.entries(b.categories ?? {}).map(([k, v]) => `${k} €${v}`),
  ]
    .filter(Boolean)
    .join(' · ');
}

function NumberField(props: { id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; perMonth?: boolean }) {
  return (
    <label htmlFor={props.id} className="block">
      <span className="text-xs font-semibold">{props.label}</span>
      {props.hint && <span className="block text-xs text-[var(--app-text-muted)]">{props.hint}</span>}
      <div className="mt-1 flex items-center border-2 border-[var(--app-border)] bg-[var(--app-bg)] focus-within:border-[var(--app-accent)]">
        <span className="pl-2 font-num text-sm text-[var(--app-text-muted)]">€</span>
        <input
          id={props.id}
          type="number"
          inputMode="decimal"
          min={0}
          step={5}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="w-full min-h-[44px] px-2 font-num text-base bg-transparent focus:outline-none"
          placeholder="0"
        />
        {props.perMonth !== false && (
          <span className="pr-2 text-xs text-[var(--app-text-muted)] whitespace-nowrap">/ month</span>
        )}
      </div>
    </label>
  );
}

export function BudgetView({ budget, history, suggestion, status, onSave, onCheckPurchase, onClose }: BudgetViewProps) {
  const listed = [...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const start = budget ?? suggestion;
  const [slips, setSlips] = useState(String(start.slips || ''));
  const [nice, setNice] = useState(String(start.nice_to_have || ''));
  const [cats, setCats] = useState<Record<string, string>>(
    Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c, budget?.categories?.[c] ? String(budget.categories[c]) : ''])),
  );
  const [showCats, setShowCats] = useState(Object.values(budget?.categories ?? {}).some((v) => v > 0));
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState(PURCHASE_KINDS[0].category);
  const [what, setWhat] = useState('');

  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));
  const save = () =>
    onSave({
      slips: num(slips),
      nice_to_have: num(nice),
      categories: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, num(v)]).filter(([, v]) => (v as number) > 0)),
    });
  const useSuggestion = () => {
    setSlips(String(suggestion.slips));
    setNice(String(suggestion.nice_to_have));
  };

  return (
    <div
      className="absolute inset-0 z-40 flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--app-bg)' }}
      data-testid="budget-view"
    >
      <div
        className="h-12 px-4 flex items-center justify-between border-b-2 shrink-0"
        style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)', marginTop: 'env(safe-area-inset-top)' }}
      >
        <span className="font-num font-bold text-xs tracking-wider">MY BUDGET</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close budget"
          className="touch-x"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        {/* This month */}
        {status && status.lines.length > 0 && (
          <section className="pixel-card p-3 space-y-2" aria-label="This month">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">This month</h3>
              <span className="text-xs text-[var(--app-text-muted)]">{status.daysLeft} days left</span>
            </div>
            {status.lines.map((l) => (
              <div key={l.key}>
                <div className="flex justify-between text-xs">
                  <span className="font-medium">{l.label}</span>
                  <span className="font-num">
                    €{l.spent.toFixed(0)} / €{l.limit.toFixed(0)}{' '}
                    <span className="font-bold" style={{ color: STATUS_COLOR[l.status] }}>
                      {l.status === 'over' ? '✕' : l.status === 'close' ? '!' : '✓'} {STATUS_LABEL[l.status]}
                    </span>
                  </span>
                </div>
                <div className="h-2 mt-1" style={{ backgroundColor: 'var(--app-surface-muted)', border: '1px solid var(--app-border)' }}>
                  <div className="h-full" style={{ width: `${Math.min(100, l.pct)}%`, backgroundColor: STATUS_COLOR[l.status] }} />
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Before you buy */}
        <section className="pixel-card p-3 space-y-2" aria-label="Before you buy">
          <h3 className="text-sm font-semibold">Thinking of buying something?</h3>
          <p className="text-xs text-[var(--app-text-muted)]">
            Mikko checks it against your budget, the money you need for bills until payday, and your emergency fund.
          </p>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (num(amount) > 0) onCheckPurchase(Number(amount), kind, what);
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <NumberField id="buy-amount" label="Price" value={amount} onChange={setAmount} perMonth={false} />
              <label htmlFor="buy-kind" className="block">
                <span className="text-xs font-semibold">What kind</span>
                <select
                  id="buy-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="mt-1 w-full min-h-[44px] px-2 text-base border-2 border-[var(--app-border)] bg-[var(--app-bg)]"
                >
                  {PURCHASE_KINDS.map((k) => (
                    <option key={k.category} value={k.category}>{k.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label htmlFor="buy-what" className="block">
              <span className="text-xs font-semibold">What is it? (optional)</span>
              <input
                id="buy-what"
                type="text"
                value={what}
                onChange={(e) => setWhat(e.target.value)}
                placeholder="e.g. new sneakers"
                className="mt-1 w-full min-h-[44px] px-2 text-base border-2 border-[var(--app-border)] bg-[var(--app-bg)] focus:outline-none focus:border-[var(--app-accent)]"
              />
            </label>
            <button
              type="submit"
              disabled={num(amount) <= 0}
              className="w-full min-h-[44px] text-sm font-semibold pixel-btn cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: 'var(--app-accent)', color: 'var(--app-accent-fg)' }}
            >
              Ask Mikko: can I afford it?
            </button>
          </form>
        </section>

        {/* Limits */}
        <section className="pixel-card p-3 space-y-3" aria-label="Monthly limits">
          <div>
            <h3 className="text-sm font-semibold">Monthly limits</h3>
            <p className="text-xs text-[var(--app-text-muted)]">
              For the two baskets you choose. Mikko's suggestion: your last 3 months, minus 10% (slips €{suggestion.slips}, nice to have €{suggestion.nice_to_have}).
            </p>
          </div>
          <NumberField id="b-slips" label="Slips" hint="Small habits up to €40: coffees, quick lunches, taxis, parking" value={slips} onChange={setSlips} />
          <NumberField id="b-nice" label="Nice to have" hint="Travel, hobbies, events, shopping, dinners out" value={nice} onChange={setNice} />

          <button
            type="button"
            onClick={() => setShowCats((v) => !v)}
            className="text-xs font-semibold underline cursor-pointer"
            aria-expanded={showCats}
          >
            {showCats ? 'Hide' : 'Add'} limits per category (optional)
          </button>
          {showCats && (
            <div className="grid grid-cols-2 gap-2">
              {BUDGET_CATEGORIES.map((c) => (
                <NumberField key={c} id={`b-cat-${c}`} label={c} value={cats[c]} onChange={(v) => setCats((p) => ({ ...p, [c]: v }))} />
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={useSuggestion}
              className="min-h-[44px] text-xs font-semibold pixel-btn cursor-pointer"
              style={{ backgroundColor: 'var(--app-surface-muted)', color: 'var(--app-text)' }}
            >
              Use Mikko's suggestion
            </button>
            <button
              type="button"
              onClick={save}
              className="min-h-[44px] text-xs font-semibold pixel-btn cursor-pointer"
              style={{ backgroundColor: 'var(--app-accent)', color: 'var(--app-accent-fg)' }}
            >
              Save budget
            </button>
          </div>
          {budget && (
            <button type="button" onClick={() => onSave(null)} className="text-xs underline text-[var(--app-text-muted)] cursor-pointer">
              Remove budget
            </button>
          )}
        </section>

        {listed.length > 0 && (
          <section className="pixel-card p-3 space-y-2" aria-label="Your budgets" data-testid="budget-history">
            <div>
              <h3 className="text-sm font-semibold">Your budgets</h3>
              <p className="text-xs text-[var(--app-text-muted)]">
                Every budget you've made. Saving a new one ends the one before.
              </p>
            </div>
            <ul className="space-y-2">
              {listed.map((b) => {
                const active = !b.endedAt;
                return (
                  <li
                    key={b.id}
                    className="p-2 flex items-start justify-between gap-2"
                    style={{
                      backgroundColor: 'var(--app-surface-muted)',
                      border: `1px solid ${active ? 'var(--app-accent)' : 'var(--app-border)'}`,
                    }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-semibold">
                        {active ? (
                          <span
                            className="px-1 text-xs font-bold"
                            style={{ backgroundColor: 'var(--app-accent)', color: 'var(--app-accent-fg)' }}
                          >
                            Active
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-[var(--app-text-muted)]">Ended</span>
                        )}
                        <span className="font-num">
                          {day(b.createdAt)}
                          {b.endedAt ? ` – ${day(b.endedAt)}` : ' – now'}
                        </span>
                      </div>
                      <div className="text-xs mt-1">{limitsText(b.budget)}</div>
                    </div>
                    {!active && (
                      <button
                        type="button"
                        onClick={() => onSave(b.budget)}
                        className="min-h-[44px] px-2 text-xs font-semibold pixel-btn cursor-pointer shrink-0"
                        style={{ backgroundColor: 'var(--app-surface)', color: 'var(--app-text)' }}
                      >
                        Use again
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
