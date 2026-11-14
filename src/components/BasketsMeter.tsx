import { useState } from 'react';
import type { BasketKey, BasketSummary } from '../game/types';

interface BasketsMeterProps {
  baskets: BasketSummary;
  /** the month the totals are for, YYYY-MM */
  monthKey: string;
  lastShiftedBasket?: BasketKey | null;
}

// Two baskets you must pay, two you choose.
const ITEMS: { key: BasketKey; label: string; title: string; color: string }[] = [
  { key: 'mandatory_regular', label: 'Regular', title: 'Mandatory & regular: rent, bills, groceries, commuting', color: '#007a45' },
  { key: 'mandatory_irregular', label: 'Irregular', title: 'Mandatory & irregular: health, repairs, appliances', color: '#2563eb' },
  { key: 'slips', label: 'Slips', title: 'Slips through your fingers: small habits up to €40 (coffees, quick lunches, taxis, parking)', color: '#c25e00' },
  { key: 'nice_to_have', label: 'Nice to have', title: 'Nice to have: things you could live without if money got tight (travel, hobbies, events, shopping, dinners out)', color: '#7c3aed' },
];

export function BasketsMeter({ baskets, monthKey, lastShiftedBasket }: BasketsMeterProps) {
  const [open, setOpen] = useState<BasketKey | null>(null);
  const month = new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const explained = ITEMS.find((i) => i.key === open);
  return (
    <section
      aria-label={`Spending per basket in ${month}`}
      data-testid="baskets-meter"
      className="px-2 pt-2 pb-2 border-b-2"
      style={{
        backgroundColor: 'var(--app-surface)',
        borderColor: 'var(--app-border)',
      }}
    >
      <div className="flex items-baseline justify-between text-xs text-[var(--app-text-muted)] mb-1">
        <span className="font-semibold">Spent in {month}</span>
        <span className="font-num">€{baskets.totalSpend.toFixed(0)} total</span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {ITEMS.map((item) => {
          const val = baskets[item.key];
          const isShifted = lastShiftedBasket === item.key;
          return (
            <button
              key={item.key}
              type="button"
              data-testid={`basket-${item.key}`}
              aria-expanded={open === item.key}
              onClick={() => setOpen((o) => (o === item.key ? null : item.key))}
              className={`min-h-[44px] px-2 py-1 min-w-0 flex items-center justify-between gap-2 text-left cursor-pointer transition-transform duration-150 ${
                isShifted ? '-translate-y-1' : ''
              }`}
              style={{
                backgroundColor: open === item.key ? 'var(--app-surface)' : 'var(--app-surface-muted)',
                border: `${open === item.key ? 2 : 1}px solid ${isShifted || open === item.key ? item.color : 'var(--app-border)'}`,
              }}
            >
              <span className="flex items-center gap-1 min-w-0">
                <span
                  className="w-2 h-2 shrink-0"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                <span className="text-xs font-semibold truncate">
                  {item.label}
                </span>
              </span>
              <span className="font-num text-xs font-bold shrink-0">
                €{val.toFixed(0)}
              </span>
            </button>
          );
        })}
      </div>
      {explained ? (
        <p data-testid="basket-explained" className="mt-1 text-xs text-[var(--app-text-muted)]">
          {explained.title}
        </p>
      ) : (
        <p className="mt-1 text-xs text-[var(--app-text-muted)]">Tap a basket to see what goes in it.</p>
      )}
    </section>
  );
}
