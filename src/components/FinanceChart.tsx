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

  if (chart.kind === 'season_compare') {
    // Bars grow up or down from the "average month" line (100).
    const span = Math.max(20, ...chart.months.flatMap((m) => [Math.abs((m.yours ?? 100) - 100), Math.abs(m.finland - 100)]));
    const H = 56; // px from the line to the top or bottom
    const bar = (v: number | null, color: string, faded: boolean, who: string, month: string) => {
      if (v == null) return <div className="flex-1" />;
      const d = v - 100;
      const h = Math.max(1, Math.round((Math.abs(d) / span) * H));
      return (
        <div className="flex-1 relative" style={{ height: H * 2 }} title={`${month} · ${who}: ${d >= 0 ? '+' : ''}${d}%`}>
          <div
            className="absolute left-0 right-0"
            style={{
              backgroundColor: color,
              opacity: faded ? 0.55 : 1,
              height: h,
              ...(d >= 0 ? { bottom: H } : { top: H }),
            }}
          />
        </div>
      );
    };
    return (
      <div className="pixel-card p-3" data-testid="chart-season-compare">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-num text-xs font-bold tracking-wide uppercase">{chart.title}</h3>
            <p className="text-[11px] text-[var(--app-text-muted)]">Up = more than an average month, down = less</p>
          </div>
          <div className="flex flex-col items-end gap-0.5 shrink-0 text-[10px] font-semibold">
            <span className="flex items-center gap-1"><i className="w-2.5 h-2 inline-block" style={{ backgroundColor: 'var(--app-text)' }} />You</span>
            <span className="flex items-center gap-1"><i className="w-2.5 h-2 inline-block opacity-55" style={{ backgroundColor: 'var(--app-text-muted)' }} />Finland</span>
          </div>
        </div>
        <div className="relative" role="img" aria-label={`Your busiest month: ${chart.yourPeak}. Finland's: ${chart.finlandPeak}.`}>
          <div className="absolute left-0 right-0 border-t" style={{ top: H, borderColor: 'var(--app-border)' }} />
          <div className="flex gap-1">
            {chart.months.map((m) => (
              <div key={m.label} className="flex-1 flex gap-px">
                {bar(m.yours, 'var(--app-text)', false, 'You', m.label)}
                {bar(m.finland, 'var(--app-text-muted)', true, 'Finland', m.label)}
              </div>
            ))}
          </div>
          <div className="flex gap-1 mt-0.5">
            {chart.months.map((m) => (
              <span key={m.label} className="flex-1 text-center font-num text-[9px] text-[var(--app-text-muted)]">
                {m.label.slice(0, 1)}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5 mt-2 text-xs">
          <div className="p-1.5" style={{ backgroundColor: 'var(--app-surface-muted)', border: '1px solid var(--app-border)' }}>
            <div className="text-[10px] text-[var(--app-text-muted)]">Your busiest month</div>
            <div className="font-semibold">{chart.yourPeak}</div>
          </div>
          <div className="p-1.5" style={{ backgroundColor: 'var(--app-surface-muted)', border: '1px solid var(--app-border)' }}>
            <div className="text-[10px] text-[var(--app-text-muted)]">Finland's busiest month</div>
            <div className="font-semibold">{chart.finlandPeak}</div>
          </div>
        </div>
        {/* In euros: your average month per quarter vs the average Finn's */}
        <table className="w-full mt-2 text-xs" aria-label="Spending per month by quarter, in euros">
          <thead>
            <tr className="font-num text-[10px] uppercase" style={{ backgroundColor: 'var(--app-surface-muted)' }}>
              <th className="text-left font-bold px-1.5 py-1">Per month</th>
              <th className="text-right font-bold px-1.5 py-1">You</th>
              <th className="text-right font-bold px-1.5 py-1">Average Finn</th>
            </tr>
          </thead>
          <tbody>
            {chart.quarters.map((q, i) => (
              <tr key={q.label} className="border-b" style={{ borderColor: 'var(--app-border)' }}>
                <td className="px-1.5 py-1">{q.label}</td>
                <td className="px-1.5 py-1 text-right font-num">{q.yours != null ? `€${q.yours.toLocaleString('en-IE')}` : '–'}</td>
                <td className="px-1.5 py-1 text-right font-num" style={{ fontWeight: i === 3 ? 700 : 400 }}>
                  €{q.finland.toLocaleString('en-IE')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-[var(--app-text-muted)] mt-1.5 leading-snug">
          Bars: shop sales, {chart.source}. Euros: {chart.quartersNote}
        </p>
      </div>
    );
  }

  if (chart.kind === 'finland_board') {
    const max = Math.max(1, ...chart.rows.flatMap((r) => [r.yours, r.finland]));
    const VERDICT = {
      more: { icon: '▲', label: 'more', color: 'var(--app-warning)' },
      less: { icon: '▼', label: 'less', color: 'var(--app-accent)' },
      similar: { icon: '≈', label: 'same', color: 'var(--app-text-muted)' },
    } as const;
    const totalDiff = chart.yoursTotal - chart.finlandTotal;
    return (
      <div className="pixel-card p-3" data-testid="chart-finland-board">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-num text-xs font-bold tracking-wide uppercase">{chart.title}</h3>
            <p className="text-[11px] text-[var(--app-text-muted)]">{chart.period} · {chart.priceNote}</p>
          </div>
          <div className="flex flex-col items-end gap-0.5 shrink-0 text-[10px] font-semibold">
            <span className="flex items-center gap-1"><i className="w-2.5 h-2 inline-block" style={{ backgroundColor: 'var(--app-text)' }} />You</span>
            <span className="flex items-center gap-1"><i className="w-2.5 h-2 inline-block opacity-60" style={{ backgroundColor: 'var(--app-text-muted)' }} />Finland</span>
          </div>
        </div>

        {/* Scoreboard header */}
        <div
          className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 px-1.5 py-1 font-num text-[10px] font-bold uppercase"
          style={{ backgroundColor: 'var(--app-surface-muted)', border: '1px solid var(--app-border)' }}
        >
          <span>Category</span>
          <span className="text-right w-12">You</span>
          <span className="text-right w-12">Fin</span>
          <span className="text-right w-12">vs</span>
        </div>
        <ul className="divide-y" style={{ borderColor: 'var(--app-border)' }}>
          {chart.rows.map((r) => {
            const v = VERDICT[r.verdict];
            return (
              <li key={r.category} className="px-1.5 py-1" style={{ borderColor: 'var(--app-border)' }}>
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 items-center text-xs">
                  <span className="font-medium truncate">{r.category}</span>
                  <span className="font-num text-right w-12">€{r.yours.toFixed(0)}</span>
                  <span className="font-num text-right w-12 text-[var(--app-text-muted)]">€{r.finland.toFixed(0)}</span>
                  <span className="font-num text-right w-12 text-[11px] font-bold" style={{ color: v.color }}>
                    {v.icon} {v.label}
                  </span>
                </div>
                <div className="mt-0.5 space-y-px" aria-hidden="true">
                  <div className="h-1" style={{ width: `${Math.max(1, (r.yours / max) * 100)}%`, backgroundColor: 'var(--app-text)' }} />
                  <div className="h-1 opacity-60" style={{ width: `${Math.max(1, (r.finland / max) * 100)}%`, backgroundColor: 'var(--app-text-muted)' }} />
                </div>
              </li>
            );
          })}
        </ul>

        {/* Total row */}
        <div
          className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 px-1.5 py-1.5 mt-1 text-xs font-bold items-center"
          style={{ backgroundColor: 'var(--app-surface-muted)', border: '1px solid var(--app-border)' }}
        >
          <span>Total</span>
          <span className="font-num text-right w-12">€{chart.yoursTotal.toFixed(0)}</span>
          <span className="font-num text-right w-12 text-[var(--app-text-muted)]">€{chart.finlandTotal.toFixed(0)}</span>
          <span
            className="font-num text-right w-12 text-[11px]"
            style={{ color: totalDiff > 0 ? 'var(--app-warning)' : 'var(--app-accent)' }}
          >
            {totalDiff > 0 ? '+' : '−'}€{Math.abs(totalDiff).toFixed(0)}
          </span>
        </div>
        <p className="text-[10px] text-[var(--app-text-muted)] mt-1.5 leading-snug">
          {chart.caveat} Source: {chart.source}.
        </p>
      </div>
    );
  }

  if (chart.kind === 'emergency_fund') {
    // Meter scaled to at least the goal, up to twice the goal.
    const scale = Math.max(chart.goalMonths, Math.min(chart.goalMonths * 2, Math.ceil(chart.monthsCovered)));
    const fillPct = Math.min(100, (Math.max(0, chart.monthsCovered) / scale) * 100);
    const goalPct = (chart.goalMonths / scale) * 100;
    const color =
      chart.status === 'reached' ? 'var(--app-accent)' : chart.status === 'building' ? '#d97706' : 'var(--app-danger)';
    const label = chart.status === 'reached' ? '✓ Goal reached' : chart.status === 'building' ? '! Getting there' : '✕ Not yet';
    return (
      <div className="pixel-card p-3.5" data-testid="chart-emergency-fund">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{chart.title}</h3>
            <p className="text-xs text-[var(--app-text-muted)]">
              Goal: {chart.goalMonths} months of money going out = €{chart.target.toFixed(0)}
            </p>
          </div>
          <span className="font-num text-[11px] font-bold shrink-0" style={{ color }}>
            {label}
          </span>
        </div>
        <div
          className="relative h-3"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={scale}
          aria-valuenow={Number(chart.monthsCovered.toFixed(1))}
          aria-label={`Emergency fund covers ${chart.monthsCovered.toFixed(1)} months, goal ${chart.goalMonths}`}
          style={{ backgroundColor: 'var(--app-surface-muted)', border: '1px solid var(--app-border)' }}
        >
          <div className="h-full" style={{ width: `${fillPct}%`, backgroundColor: color }} />
          <div
            className="absolute -top-1 -bottom-1 w-0.5"
            style={{ left: `calc(${goalPct}% - 1px)`, backgroundColor: 'var(--app-text)' }}
            title={`${chart.goalMonths}-month goal`}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          {[
            ['On account', `€${chart.balance.toFixed(0)}`],
            ['Months', chart.monthsCovered.toFixed(1)],
            [chart.balance >= chart.target ? 'Above goal' : 'To go', `€${Math.abs(chart.target - chart.balance).toFixed(0)}`],
          ].map(([k, v]) => (
            <div key={k} className="p-1.5" style={{ backgroundColor: 'var(--app-surface-muted)', border: '1px solid var(--app-border)' }}>
              <div className="text-[11px] text-[var(--app-text-muted)]">{k}</div>
              <div className="font-num text-sm font-bold">{v}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-[var(--app-text-muted)] mt-2">
          Money going out averages €{chart.monthlyOutgoings.toFixed(0)}/mo. Investments don't count: they aren't instant cash.
        </p>
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
