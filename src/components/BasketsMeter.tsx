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
  const month = new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <section
      aria-label={`Spending per basket in ${month}`}
      data-testid="baskets-meter"
      className="px-2 pt-1 pb-1.5 short:pb-1 border-b-2"
      style={{
        backgroundColor: 'var(--app-surface)',
        borderColor: 'var(--app-border)',
      }}
    >
      <div className="flex items-baseline justify-between text-[10px] text-[var(--app-text-muted)] mb-0.5">
        <span className="font-semibold">Spent in {month}</span>
        <span className="font-num">€{baskets.totalSpend.toFixed(0)} total</span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {ITEMS.map((item) => {
          const val = baskets[item.key];
          const isShifted = lastShiftedBasket === item.key;
          return (
            <div
              key={item.key}
              data-testid={`basket-${item.key}`}
              title={item.title}
              className={`px-1.5 py-1 min-w-0 transition-transform duration-150 ${
                isShifted ? '-translate-y-0.5' : ''
              }`}
              style={{
                backgroundColor: 'var(--app-surface-muted)',
                border: `1px solid ${isShifted ? item.color : 'var(--app-border)'}`,
              }}
            >
              <div className="flex items-center gap-1 min-w-0">
                <span
                  className="w-2 h-2 shrink-0"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                <span className="text-[10px] font-semibold truncate">
                  {item.label}
                </span>
              </div>
              <div className="font-num text-[11px] font-bold leading-tight">
                €{val.toFixed(0)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
