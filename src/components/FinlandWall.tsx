import { X } from 'lucide-react';
import type { ChartPayload } from '../game/types';

type Board = Extract<ChartPayload, { kind: 'finland_board' }>;

interface FinlandWallProps {
  board: Board;
  picked?: string;
  onPick: (category: string) => void;
  onClose: () => void;
}

/** Percentage difference vs Finland, e.g. +287 or -52. */
export function pctVsFinland(row: Board['rows'][number]): number {
  return row.finland > 0 ? Math.round(((row.yours - row.finland) / row.finland) * 100) : 0;
}

// Status colours paired with an arrow and a sign, never colour alone.
const TONE = {
  more: { color: '#b91c1c', arrow: '▲' },
  less: { color: '#15803d', arrow: '▼' },
  similar: { color: 'var(--app-text-muted)', arrow: '≈' },
} as const;

/**
 * "You vs Finland" pinned to the wall of Mikko's room: one tile per category
 * on either side of him. Tap a tile for the details.
 */
export function FinlandWall({ board, picked, onPick, onClose }: FinlandWallProps) {
  const half = Math.ceil(board.rows.length / 2);
  const columns = [board.rows.slice(0, half), board.rows.slice(half)];

  const tile = (row: Board['rows'][number]) => {
    const pct = pctVsFinland(row);
    const tone = TONE[row.verdict];
    const isPicked = picked === row.category;
    return (
      <button
        key={row.category}
        type="button"
        onClick={() => onPick(row.category)}
        aria-pressed={isPicked}
        aria-label={`${row.category}: ${pct > 0 ? '+' : ''}${pct}% vs Finland. You €${row.yours.toFixed(0)}, Finland €${row.finland.toFixed(0)}. Tap for details.`}
        className="w-full min-h-[30px] px-1.5 py-1 flex items-center justify-between gap-1 text-left cursor-pointer pixel-btn"
        style={{
          backgroundColor: 'var(--app-surface)',
          borderColor: isPicked ? tone.color : 'var(--app-border)',
          outline: isPicked ? `2px solid ${tone.color}` : 'none',
          outlineOffset: '-2px',
        }}
      >
        <span className="text-[11px] font-semibold truncate min-w-0">{row.category}</span>
        <span className="font-num text-[11px] font-bold shrink-0" style={{ color: tone.color }}>
          {tone.arrow}
          {pct > 0 ? '+' : pct < 0 ? '−' : ''}
          {Math.abs(pct)}%
        </span>
      </button>
    );
  };

  return (
    <div className="absolute inset-0 z-10 pointer-events-none" data-testid="finland-wall">
      {/* Title strip at the top of the wall */}
      <div
        className="absolute top-1.5 left-1/2 -translate-x-1/2 pointer-events-auto flex items-center gap-1.5 pl-2 pr-1 py-0.5 border-2"
        style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)', boxShadow: 'var(--pixel-shadow)' }}
      >
        <span className="font-num text-[10px] font-bold uppercase whitespace-nowrap">
          You vs Finland · {board.ageGroup}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide the comparison"
          className="w-5 h-5 grid place-items-center cursor-pointer"
          style={{ backgroundColor: 'var(--app-surface-muted)' }}
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Two columns of tiles, either side of Mikko, above the desk */}
      {columns.map((rows, i) => (
        <div
          key={i}
          className={`absolute top-9 bottom-[17%] w-[34%] max-w-[170px] flex flex-col justify-center gap-1 overflow-y-auto pointer-events-auto ${
            i === 0 ? 'left-1.5' : 'right-1.5'
          }`}
        >
          {rows.map(tile)}
        </div>
      ))}
    </div>
  );
}
