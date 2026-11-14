import type { BasketKey, BasketSummary } from '../game/types';

interface BasketsMeterProps {
  baskets: BasketSummary;
  lastShiftedBasket?: BasketKey | null;
}

const ITEMS: { key: BasketKey; label: string; color: string }[] = [
  { key: 'mandatory_regular', label: 'Regular', color: '#007a45' },
  { key: 'mandatory_irregular', label: 'Irregular', color: '#2563eb' },
  { key: 'slips', label: 'Slips', color: '#c25e00' },
];

export function BasketsMeter({ baskets, lastShiftedBasket }: BasketsMeterProps) {
  return (
    <section
      aria-label="Three Spending Baskets"
      data-testid="baskets-meter"
      className="grid grid-cols-3 gap-1.5 px-2.5 py-2 border-b-2"
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
            className={`px-2 py-1 flex items-center justify-between gap-1 transition-transform duration-150 ${
              isShifted ? '-translate-y-0.5' : ''
            }`}
            style={{
              backgroundColor: 'var(--app-surface-muted)',
              border: `1px solid ${isShifted ? item.color : 'var(--app-border)'}`,
            }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-2 h-2 shrink-0"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              <span className="text-[11px] font-semibold truncate">
                {item.label}
              </span>
            </div>
            <span className="font-num text-[11px] font-bold shrink-0">
              €{val.toFixed(0)}
            </span>
          </div>
        );
      })}
    </section>
  );
}
