import { useState } from 'react';
import { X } from 'lucide-react';
import { SHOP_CATALOG } from '../game/data';
import type { PlayerProgress, ShopItem } from '../game/types';
import { PixelCardPreview } from './PixelCardPreview';
import { PixelMentorScene } from './PixelMentorScene';

interface LockerViewProps {
  progress: PlayerProgress;
  holderName: string;
  slipsSharePct: number;
  onSelectShopItem: (item: ShopItem) => void;
  onClose?: () => void;
  onResetDemo: () => void;
  feedbackMsg?: string | null;
  embedded?: boolean;
}

export function LockerView({
  progress,
  holderName,
  slipsSharePct,
  onSelectShopItem,
  onClose,
  onResetDemo,
  feedbackMsg,
  embedded = false,
}: LockerViewProps) {
  const [activeSlot, setActiveSlot] = useState<ShopItem['slot']>('mentor_style');

  const isEquipped = (item: ShopItem) => {
    if (item.slot === 'mentor_style') return progress.equippedStyle === item.value;
    if (item.slot === 'app_theme') return progress.equippedTheme === item.value;
    return progress.equippedCardSkin === item.value;
  };

  const items = SHOP_CATALOG.filter((i) => i.slot === activeSlot);

  return (
    <div
      className={
        embedded
          ? 'p-3 space-y-3'
          : 'absolute inset-0 z-40 flex flex-col overflow-hidden'
      }
      style={{ backgroundColor: 'var(--app-bg)' }}
      data-testid="locker-view"
    >
      {!embedded && (
        <div
          className="h-12 px-3.5 flex items-center justify-between border-b-2 shrink-0"
          style={{
            backgroundColor: 'var(--app-surface)',
            borderColor: 'var(--app-border)',
          }}
        >
          <div className="flex items-center gap-2">
            <span className="font-num font-bold text-xs tracking-wider">LOCKER</span>
            <span className="text-xs text-[var(--app-text-muted)]">·</span>
            <span className="font-num text-xs font-bold">
              Lvl {progress.level} · {progress.coins} Coins
            </span>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close locker"
              className="w-8 h-8 flex items-center justify-center border border-[var(--app-border)] cursor-pointer"
              style={{ backgroundColor: 'var(--app-surface-muted)' }}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      <div className={embedded ? 'space-y-3' : 'flex-1 overflow-y-auto p-3.5 space-y-3'}>
        {/* Live Preview */}
        <div className="pixel-card p-3 flex flex-col items-center gap-3">
          <div className="w-full flex items-center justify-center gap-3">
            <PixelMentorScene
              mood="impressed"
              styleId={progress.equippedStyle}
              slipsSharePct={slipsSharePct}
              streakWeeks={progress.streakWeeks}
              variant="mini"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold">Mikko & Your Card</div>
              <div className="text-[11px] text-[var(--app-text-muted)] mt-0.5">
                Earn XP & Coins from honest audits to unlock outfits, themes, and card skins.
              </div>
            </div>
          </div>

          <PixelCardPreview
            skinId={progress.equippedCardSkin}
            holderName={holderName}
            compact
          />

          {feedbackMsg && (
            <div
              className="w-full text-xs font-medium px-2.5 py-1.5 text-center"
              style={{
                backgroundColor: 'var(--app-surface-muted)',
                border: '1px solid var(--app-border)',
              }}
            >
              {feedbackMsg}
            </div>
          )}
        </div>

        {/* Category Tabs */}
        <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label="Locker categories">
          {(
            [
              { slot: 'mentor_style', label: 'Outfits' },
              { slot: 'app_theme', label: 'Themes' },
              { slot: 'card_skin', label: 'Card Skins' },
            ] as const
          ).map((tab) => {
            const active = activeSlot === tab.slot;
            return (
              <button
                key={tab.slot}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveSlot(tab.slot)}
                className="py-2 text-xs font-semibold pixel-btn cursor-pointer whitespace-nowrap"
                style={{
                  backgroundColor: active
                    ? 'var(--app-accent)'
                    : 'var(--app-surface)',
                  color: active ? 'var(--app-accent-fg)' : 'var(--app-text)',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Items List */}
        <div className="space-y-2">
          {items.map((item) => {
            const owned = progress.unlockedItems.includes(item.id);
            const equipped = isEquipped(item);
            const levelMet = progress.level >= item.requiredLevel;
            const canAfford = progress.coins >= item.coinCost;
            const disabled = !owned && (!levelMet || !canAfford);

            let buttonLabel = 'Equip';
            if (equipped) buttonLabel = 'Equipped';
            else if (!owned && !levelMet) buttonLabel = `Lvl ${item.requiredLevel}`;
            else if (!owned) buttonLabel = `Buy ${item.coinCost}c`;

            return (
              <div
                key={item.id}
                className="pixel-card p-2.5 flex items-center justify-between gap-2.5"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{item.name}</div>
                  <div className="text-[11px] text-[var(--app-text-muted)] truncate">
                    {item.description}
                  </div>
                  <div className="text-[11px] font-num text-[var(--app-text-muted)] mt-0.5">
                    {owned
                      ? 'Unlocked'
                      : `Requires Lvl ${item.requiredLevel} · ${item.coinCost}c`}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={disabled || equipped}
                  onClick={() => onSelectShopItem(item)}
                  className="px-3 py-2 text-xs font-semibold pixel-btn shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  style={{
                    backgroundColor: equipped
                      ? 'var(--app-accent)'
                      : 'var(--app-surface-muted)',
                    color: equipped ? 'var(--app-accent-fg)' : 'var(--app-text)',
                  }}
                >
                  {buttonLabel}
                </button>
              </div>
            );
          })}
        </div>

        <div className="pt-2 flex justify-center">
          <button
            type="button"
            onClick={onResetDemo}
            className="text-xs underline underline-offset-2 text-[var(--app-text-muted)] hover:text-[var(--app-text)] cursor-pointer"
          >
            Reset demo progress
          </button>
        </div>
      </div>
    </div>
  );
}
