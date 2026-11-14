import type { CardSkinId } from '../game/types';

interface PixelCardPreviewProps {
  skinId: CardSkinId;
  holderName: string;
  compact?: boolean;
}

const SKIN_STYLES: Record<
  CardSkinId,
  {
    bg: string;
    border: string;
    accent: string;
    text: string;
    label: string;
    patternColor: string;
  }
> = {
  classic_green: {
    bg: '#007a45',
    border: '#004728',
    accent: '#86efac',
    text: '#ffffff',
    label: 'S-Etukortti Classic',
    patternColor: '#009354',
  },
  emerald_foil: {
    bg: '#065f46',
    border: '#022c22',
    accent: '#34d399',
    text: '#ecfdf5',
    label: '8-Bit Emerald Foil',
    patternColor: '#10b981',
  },
  nokia_brick: {
    bg: '#334155',
    border: '#0f172a',
    accent: '#9db897',
    text: '#f1f5f9',
    label: '90s Brick Edition',
    patternColor: '#475569',
  },
  golden_possu: {
    bg: '#b45309',
    border: '#451a03',
    accent: '#fde047',
    text: '#fffbeb',
    label: 'Golden S-Possu',
    patternColor: '#d97706',
  },
  holo_prism: {
    bg: '#134e4a',
    border: '#042f2e',
    accent: '#5eead4',
    text: '#f0fdfa',
    label: 'Holographic Prism',
    patternColor: '#0d9488',
  },
};

export function PixelCardPreview({
  skinId,
  holderName,
  compact = false,
}: PixelCardPreviewProps) {
  const skin = SKIN_STYLES[skinId];

  return (
    <div
      data-testid="pixel-card-preview"
      data-skin={skinId}
      className={`relative overflow-hidden select-none transition-transform duration-150 ${
        compact ? 'w-full max-w-[260px]' : 'w-full max-w-[320px]'
      }`}
      style={{
        backgroundColor: skin.bg,
        border: `3px solid ${skin.border}`,
        boxShadow: `4px 4px 0px ${skin.border}`,
        color: skin.text,
      }}
    >
      {/* Pixel dither checkerboard strip */}
      <svg
        viewBox="0 0 64 40"
        shapeRendering="crispEdges"
        className="w-full h-auto block pixel-crisp"
        role="img"
        aria-label={`Virtual S-Pankki debit card with ${skin.label} skin`}
      >
        <rect x="0" y="0" width="64" height="40" fill={skin.bg} />
        {/* Dither pattern corner */}
        {[0, 2, 4, 6, 8, 10].map((dx) =>
          [0, 2, 4, 6].map((dy) => (
            <rect
              key={`${dx}-${dy}`}
              x={50 + dx}
              y={2 + dy}
              width="1"
              height="1"
              fill={skin.patternColor}
            />
          )),
        )}
        {skinId === 'holo_prism' && (
          <>
            <rect x="0" y="14" width="64" height="2" fill="#2dd4bf" opacity="0.45" />
            <rect x="0" y="18" width="64" height="1" fill="#fde047" opacity="0.35" />
          </>
        )}
        {/* Pixel EMV Chip */}
        <rect x="6" y="15" width="9" height="7" fill={skin.accent} />
        <rect x="8" y="17" width="5" height="3" fill={skin.bg} />
        <rect x="6" y="18" width="9" height="1" fill={skin.border} opacity="0.35" />

        {/* S-Pankki pixel emblem top-left */}
        <rect x="6" y="5" width="6" height="6" fill={skin.accent} />
        <rect x="8" y="6" width="3" height="1" fill={skin.bg} />
        <rect x="7" y="7" width="2" height="1" fill={skin.bg} />
        <rect x="8" y="8" width="3" height="1" fill={skin.bg} />
        <rect x="7" y="9" width="3" height="1" fill={skin.bg} />

        {/* Golden Piggy pixel icon for golden_possu */}
        {skinId === 'golden_possu' && (
          <g>
            <rect x="48" y="23" width="8" height="5" fill="#fde047" />
            <rect x="56" y="25" width="2" height="2" fill="#fde047" />
            <rect x="49" y="28" width="2" height="2" fill="#fde047" />
            <rect x="53" y="28" width="2" height="2" fill="#fde047" />
            <rect x="54" y="24" width="1" height="1" fill="#451a03" />
          </g>
        )}
      </svg>

      {/* Crisp overlay typography */}
      <div className="absolute inset-0 p-4 flex flex-col justify-between pointer-events-none">
        <div className="flex items-start justify-between pl-11">
          <span className="font-pixel text-xs tracking-tight leading-none">
            S-PANKKI
          </span>
          <span
            className="font-pixel text-xs leading-none"
            style={{ color: skin.accent }}
          >
            VISA
          </span>
        </div>

        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs opacity-85 leading-tight">
              {skin.label}
            </div>
            <div className="font-num text-xs font-semibold tracking-wider mt-1">
              {holderName.toUpperCase()} · •••• 4821
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
