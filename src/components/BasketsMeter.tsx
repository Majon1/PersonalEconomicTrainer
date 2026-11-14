import type { BasketKey, BasketSummary } from '../game/types';

interface BasketsMeterProps {
  baskets: BasketSummary;
  lastShiftedBasket?: BasketKey | null;
}

// Two baskets you must pay, two you choose.
const ITEMS: { key: BasketKey; label: string; title: string; color: string }[] = [
  { key: 'mandatory_regular', label: 'Regular', title: 'Mandatory & regular: rent, bills, groceries, commuting', color: '#007a45' },
  { key: 'mandatory_irregular', label: 'Irregular', title: 'Mandatory & irregular: health, repairs, appliances', color: '#2563eb' },
  { key: 'slips', label: 'Slips', title: 'Slips through your fingers: small habits up to €40 (coffees, quick lunches, taxis, parking)', color: '#c25e00' },
  { key: 'nice_to_have', label: 'Nice', title: 'Nice to have: things you could live without if money got tight (travel, hobbies, events, shopping, dinners out)', color: '#7c3aed' },
];

export function BasketsMeter({ baskets, lastShiftedBasket }: BasketsMeterProps) {
  return (
    <section
      aria-label="Four Spending Baskets"
      data-testid="baskets-meter"
      className="grid grid-cols-4 gap-1 px-2 py-1.5 short:py-1 border-b-2"
      style={{
        backgroundColor: 'var(--app-surface)',
        borderColor: 'var(--app-border)',
      }}
    >
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
    </section>
  );
}
