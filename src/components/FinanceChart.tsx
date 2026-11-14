import type { ChartPayload, WhatIfAsset } from '../game/types';

interface FinanceChartProps {
  chart: ChartPayload;
  onChangeWhatIfAsset?: (asset: WhatIfAsset) => void;
  onChangeWhatIfMonths?: (months: number) => void;
  onPledgeCutback?: (label: string, monthlyAmount: number) => void;
  pledgedActive?: boolean;
}

export function FinanceChart({
  chart,
  onChangeWhatIfAsset,
  onChangeWhatIfMonths,
  onPledgeCutback,
  pledgedActive = false,
}: FinanceChartProps) {
  if (chart.kind === 'bar') {
    const maxVal = Math.max(1, ...chart.bars.map((b) => b.value));
    return (
      <div className="pixel-card p-3.5" data-testid="chart-bar">
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-semibold">{chart.title}</h3>
            <p className="text-xs text-[var(--app-text-muted)]">{chart.subtitle}</p>
          </div>
          <span className="font-num text-xs text-[var(--app-text-muted)]">EUR</span>
        </div>

        <div className="space-y-2.5">
          {chart.bars.map((bar) => {
            const widthPct = Math.max(4, Math.round((bar.value / maxVal) * 100));
            return (
              <div key={bar.label} className="grid grid-cols-[44px_1fr_68px] items-center gap-2.5">
                <span className="text-xs font-medium text-[var(--app-text-muted)]">
                  {bar.label}
                </span>
                <div
                  className="h-5 w-full overflow-hidden"
                  style={{
                    backgroundColor: 'var(--app-surface-muted)',
                    border: '1px solid var(--app-border)',
                  }}
                >
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: bar.highlight
                        ? 'var(--app-warning)'
                        : 'var(--app-accent)',
                    }}
                  />
                </div>
                <span className="font-num text-xs font-semibold text-right">
                  €{bar.value.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (chart.kind === 'safe_to_spend') {
    return (
      <div className="pixel-card p-3.5" data-testid="chart-safe-to-spend">
        <div className="flex items-baseline justify-between mb-2.5">
          <h3 className="text-sm font-semibold">{chart.title}</h3>
          <span className="font-num text-xs text-[var(--app-text-muted)]">
            Balance €{chart.currentBalance.toFixed(2)}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div
            className="p-2"
            style={{
              backgroundColor: 'var(--app-surface-muted)',
              border: '1px solid var(--app-border)',
            }}
          >
            <div className="text-[11px] text-[var(--app-text-muted)]">Locked Bills</div>
            <div className="font-num text-sm font-bold mt-0.5">
              €{chart.reservedRegular.toFixed(0)}
            </div>
          </div>
          <div
            className="p-2"
            style={{
              backgroundColor: 'var(--app-surface-muted)',
              border: '1px solid var(--app-border)',
            }}
          >
            <div className="text-[11px] text-[var(--app-text-muted)]">Surprise Shield</div>
            <div className="font-num text-sm font-bold mt-0.5">
              €{chart.surpriseBuffer.toFixed(0)}
            </div>
          </div>
          <div
            className="p-2"
            style={{
              backgroundColor: 'var(--app-accent)',
              color: 'var(--app-accent-fg)',
              border: '1px solid var(--app-border)',
            }}
          >
            <div className="text-[11px] opacity-90">Safe / Week</div>
            <div className="font-num text-sm font-bold mt-0.5">
              €{chart.safeWeekly.toFixed(2)}
            </div>
          </div>
        </div>

        <p className="text-xs text-[var(--app-text-muted)] font-num">
          Daily allowance: €{chart.dailyAllowance.toFixed(2)}/day after reserving bills & buffer.
        </p>
      </div>
    );
  }

  if (chart.kind === 'peer_compare') {
    const maxVal = Math.max(
      1,
      ...chart.rows.flatMap((r) => [r.yours, r.finlandAvg]),
    );
    return (
      <div className="pixel-card p-3.5" data-testid="chart-peer-compare">
        <div className="mb-3">
          <h3 className="text-sm font-semibold">{chart.title}</h3>
          <p className="text-xs text-[var(--app-text-muted)]">{chart.subtitle}</p>
        </div>

        <div className="space-y-3">
          {chart.rows.map((row) => {
            const yoursW = Math.max(4, Math.round((row.yours / maxVal) * 100));
            const avgW = Math.max(4, Math.round((row.finlandAvg / maxVal) * 100));
            const over = row.yours > row.finlandAvg;
            return (
              <div key={row.category} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium">{row.category}</span>
                  <span className="font-num text-[var(--app-text-muted)]">
                    You €{row.yours.toFixed(0)} · Finland €{row.finlandAvg}
                  </span>
                </div>
                <div className="space-y-1">
                  <div
                    className="h-2.5 transition-all duration-300"
                    style={{
                      width: `${yoursW}%`,
                      backgroundColor: over
                        ? 'var(--app-warning)'
                        : 'var(--app-accent)',
                    }}
                    title={`You: €${row.yours.toFixed(0)}`}
                  />
                  <div
                    className="h-2 opacity-65"
                    style={{
                      width: `${avgW}%`,
                      backgroundColor: 'var(--app-text-muted)',
                    }}
                    title={`Stats Finland Avg: €${row.finlandAvg}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4 mt-3 text-[11px] text-[var(--app-text-muted)]">
          <span>Top bar: Your spend</span>
          <span>·</span>
          <span>Bottom bar: Stats Finland peer avg</span>
        </div>
      </div>
    );
  }

  // What-If Replay Chart (Index Fund default vs Nokia vs Savings vs Cash)
  const { result, sourceLabel } = chart;
  const pts = result.points;
  const allValues = pts.flatMap((p) => [
    p.cashPile,
    p.savingsValue,
    p.assetValue,
  ]);
  const maxY = Math.max(10, ...allValues);
  const minY = 0;

  const W = 320;
  const H = 140;
  const padL = 8;
  const padR = 8;
  const padT = 10;
  const padB = 14;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const toX = (idx: number) =>
    pts.length <= 1 ? padL : padL + (idx / (pts.length - 1)) * plotW;
  const toY = (val: number) =>
    padT + plotH - ((val - minY) / (maxY - minY)) * plotH;

  const buildPath = (getter: (p: (typeof pts)[number]) => number) =>
    pts
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(getter(p)).toFixed(1)}`,
      )
      .join(' ');

  return (
    <div className="pixel-card p-2.5" data-testid="chart-what-if">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1.5">
        <div>
          <h3 className="text-sm font-semibold">{sourceLabel}</h3>
          <p className="text-xs text-[var(--app-text-muted)]">
            Historical market replay of €{result.monthlyAmount.toFixed(2)}/mo ·{' '}
            {result.months} mos
          </p>
        </div>
      </div>

      {/* Asset + Horizon switches */}
      {(onChangeWhatIfAsset || onChangeWhatIfMonths) && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          {onChangeWhatIfAsset && (
            <div className="flex gap-1.5" role="group" aria-label="Simulation asset">
              {(
                [
                  { id: 'index_fund', label: 'Index Fund' },
                  { id: 'nokia', label: 'Nokia Stock' },
                  { id: 'savings', label: 'S-Savings' },
                ] as { id: WhatIfAsset; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeWhatIfAsset(opt.id)}
                  className="px-2.5 py-1.5 text-xs font-semibold pixel-btn cursor-pointer whitespace-nowrap"
                  style={{
                    backgroundColor:
                      result.asset === opt.id
                        ? 'var(--app-accent)'
                        : 'var(--app-surface-muted)',
                    color:
                      result.asset === opt.id
                        ? 'var(--app-accent-fg)'
                        : 'var(--app-text)',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {onChangeWhatIfMonths && (
            <div className="flex gap-1" role="group" aria-label="Replay duration">
              {[18, 36, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChangeWhatIfMonths(m)}
                  className="px-2 py-1 text-xs font-num pixel-btn cursor-pointer"
                  style={{
                    backgroundColor:
                      result.months === m
                        ? 'var(--app-text)'
                        : 'var(--app-surface-muted)',
                    color:
                      result.months === m
                        ? 'var(--app-surface)'
                        : 'var(--app-text)',
                  }}
                >
                  {m}m
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Clean SVG Curves */}
      <div
        className="p-1.5 mb-2"
        style={{
          backgroundColor: 'var(--app-surface-muted)',
          border: '1px solid var(--app-border)',
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20 overflow-visible">
          {/* Grid lines */}
          {[0.25, 0.5, 0.75, 1].map((frac) => {
            const y = padT + plotH * (1 - frac);
            return (
              <line
                key={frac}
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke="var(--app-border)"
                strokeDasharray="3 3"
              />
            );
          })}

          {/* Cash Pile (dashed neutral) */}
          <path
            d={buildPath((p) => p.cashPile)}
            fill="none"
            stroke="var(--app-text-muted)"
            strokeWidth="2"
            strokeDasharray="4 3"
          />

          {/* Savings Account (thin blue/slate) */}
          <path
            d={buildPath((p) => p.savingsValue)}
            fill="none"
            stroke="#2563eb"
            strokeWidth="2"
          />

          {/* Selected Asset (thick primary) */}
          <path
            d={buildPath((p) => p.assetValue)}
            fill="none"
            stroke={result.asset === 'nokia' ? 'var(--app-warning)' : 'var(--app-accent)'}
            strokeWidth="3"
          />
        </svg>
      </div>

      {/* Numeric Readout */}
      <div className="grid grid-cols-3 gap-2 text-xs mb-2">
        <div>
          <div className="text-[11px] text-[var(--app-text-muted)]">Cash Saved</div>
          <div className="font-num font-bold">€{result.totalCash.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--app-text-muted)]">S-Savings</div>
          <div className="font-num font-bold text-blue-600">
            €{result.finalSavingsValue.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--app-text-muted)]">
            {result.asset === 'index_fund'
              ? 'Index Fund'
              : result.asset === 'nokia'
                ? 'NOKIA.HE'
                : 'Savings'}
          </div>
          <div
            className="font-num font-bold"
            style={{
              color:
                result.asset === 'nokia'
                  ? 'var(--app-warning)'
                  : 'var(--app-accent)',
            }}
          >
            €{result.finalAssetValue.toFixed(2)}
          </div>
        </div>
      </div>

      {onPledgeCutback && (
        <button
          type="button"
          disabled={pledgedActive}
          onClick={() => onPledgeCutback(sourceLabel, result.monthlyAmount)}
          className="w-full py-2 px-4 text-xs font-semibold pixel-btn cursor-pointer disabled:opacity-60"
          style={{
            backgroundColor: pledgedActive
              ? 'var(--app-surface-muted)'
              : 'var(--app-accent)',
            color: pledgedActive ? 'var(--app-text)' : 'var(--app-accent-fg)',
          }}
        >
          {pledgedActive
            ? `Pledge Active (+50 XP/wk streak)`
            : `Pledge Cutback (€${result.monthlyAmount.toFixed(2)}/mo · +25 XP)`}
        </button>
      )}
    </div>
  );
}
