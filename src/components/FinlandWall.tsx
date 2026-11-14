import { X } from 'lucide-react';
import type { ChartPayload } from '../game/types';

type Board = Extract<ChartPayload, { kind: 'finland_board' }>;

interface FinlandWallProps {
  board: Board;
  picked?: string;
  onPick: (category: string) => void;
  onSeasons: () => void;
  /** opens or closes the full table under Mikko */
  onShowAll: () => void;
  tableOpen: boolean;
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

/** Tiles per side of Mikko; the rest are in the full table. */
const PER_SIDE = 4;

/**
 * "You vs Finland" pinned to the wall of Mikko's room: the biggest gaps on
 * either side of him. Tap a tile for the details.
 */
export function FinlandWall({ board, picked, onPick, onSeasons, onShowAll, tableOpen, onClose }: FinlandWallProps) {
  const notable = [...board.rows]
    .sort((a, b) => Math.abs(pctVsFinland(b)) - Math.abs(pctVsFinland(a)))
    .slice(0, PER_SIDE * 2);
  const half = Math.ceil(notable.length / 2);
  const columns = [notable.slice(0, half), notable.slice(half)];
  const hidden = board.rows.length - notable.length;

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
        className="w-full min-h-[36px] px-2 flex items-center justify-between gap-1 text-left cursor-pointer pixel-btn"
        style={{
          backgroundColor: 'var(--app-surface)',
          borderColor: isPicked ? tone.color : 'var(--app-border)',
          outline: isPicked ? `2px solid ${tone.color}` : 'none',
          outlineOffset: '-2px',
        }}
      >
        <span className="text-xs font-semibold truncate min-w-0">{row.category}</span>
        <span className="font-num text-xs font-bold shrink-0" style={{ color: tone.color }}>
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
        className="absolute top-2 left-2 right-2 pointer-events-auto flex items-center gap-2 pl-2 border-2"
        style={{ backgroundColor: 'var(--app-surface)', borderColor: 'var(--app-border)', boxShadow: 'var(--pixel-shadow)' }}
      >
        <span className="flex-1 min-w-0 font-num text-xs font-bold uppercase truncate">
          vs Finland · {board.ageGroup}
        </span>
        <button
          type="button"
          onClick={onShowAll}
          aria-expanded={tableOpen}
          data-testid="show-all-categories"
          className="min-h-[44px] px-2 text-xs font-semibold cursor-pointer underline shrink-0"
        >
          {tableOpen ? 'Hide table' : hidden > 0 ? `All ${board.rows.length}` : 'Table'}
        </button>
        <button
          type="button"
          onClick={onSeasons}
          data-testid="show-seasons"
          className="min-h-[44px] px-2 text-xs font-semibold cursor-pointer underline shrink-0"
        >
          Seasons
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide the comparison"
          className="touch-x !border-0 !border-l-2"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Two columns of tiles, either side of Mikko, above the desk */}
      {!tableOpen && columns.map((rows, i) => (
        <div
          key={i}
          className={`absolute top-16 bottom-[17%] w-[30%] max-w-[136px] flex flex-col justify-center gap-1 pointer-events-auto short:hidden ${
            i === 0 ? 'left-2' : 'right-2'
          }`}
        >
          {rows.map(tile)}
        </div>
      ))}
    </div>
  );
}
