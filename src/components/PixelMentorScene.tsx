import { useEffect, useState } from 'react';
import type { MentorMood, MentorStyleId } from '../game/types';

interface PixelMentorSceneProps {
  mood: MentorMood;
  styleId: MentorStyleId;
  slipsSharePct: number;
  streakWeeks: number;
  variant?: 'background' | 'mini';
  /** Open laptop and typing, while Mikko looks something up. */
  thinking?: boolean;
  /** Yellow question mark. Only when he is actually waiting on an answer. */
  hasQuestion?: boolean;
}

export function PixelMentorScene({
  mood,
  styleId,
  slipsSharePct,
  streakWeeks,
  variant = 'background',
  thinking = false,
  hasQuestion = false,
}: PixelMentorSceneProps) {
  const [tick, setTick] = useState(0);
  const [searchPhase, setSearchPhase] = useState<'idle' | 'grabbing' | 'searching'>(
    thinking ? 'searching' : 'idle',
  );
  const [grabStep, setGrabStep] = useState<0 | 1>(0);

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      setTick((t) => (t + 1) % 8);
    }, 280);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!thinking) {
      setSearchPhase('idle');
      setGrabStep(0);
      return;
    }
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setSearchPhase('searching');
      return;
    }
    setSearchPhase('grabbing');
    setGrabStep(0);
    const t1 = window.setTimeout(() => setGrabStep(1), 160);
    const t2 = window.setTimeout(() => setSearchPhase('searching'), 340);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [thinking]);

  const highSlips = slipsSharePct >= 22;
  const stepOdd = tick % 2 === 1;
  const isBlinking = mood === 'deadpan' && tick === 7 && searchPhase === 'idle';

  const coatColor =
    styleId === 'detective_coat'
      ? '#b08952'
      : styleId === 'sauna_beanie'
        ? '#2f5e4e'
        : styleId === 'golden_crown'
          ? '#1a3c2d'
          : '#00683c';

  const coatTrim =
    styleId === 'detective_coat'
      ? '#7c5c30'
      : styleId === 'golden_crown'
        ? '#eab308'
        : '#004728';

  let bodyX = 0;
  let bodyY = 0;
  let headX = 0;
  let headY = 0;

  if (searchPhase === 'grabbing') {
    bodyX = grabStep === 0 ? 3 : 1;
    headX = grabStep === 0 ? 2 : 1;
  } else if (searchPhase === 'searching') {
    headY = 1;
    headX = stepOdd ? 0 : -1;
  } else if (mood === 'deadpan') {
    headY = tick % 4 === 2 ? 1 : 0;
  } else if (mood === 'suspicious') {
    bodyY = stepOdd ? 0 : 1;
    headX = tick % 4 < 2 ? 0 : -1;
  } else if (mood === 'pointing') {
    bodyX = -2;
    headY = stepOdd ? 1 : 0;
  } else if (mood === 'bluff_caught') {
    headX = stepOdd ? -1 : 1;
  } else if (mood === 'impressed' || mood === 'level_up') {
    bodyY = stepOdd ? -2 : 0;
    headY = stepOdd ? -2 : 0;
  }

  const eyeDirX =
    searchPhase === 'grabbing'
      ? 1
      : searchPhase === 'searching'
        ? tick % 2
        : mood === 'suspicious'
          ? tick % 4 < 2
            ? 0
            : 1
          : 0;
  let eyeDirY = mood === 'pointing' ? 1 : 0;
  if (searchPhase === 'searching') {
    eyeDirY = 1;
  }

  // Mini preview for the Locker drawer
  if (variant === 'mini') {
    return (
      <div
        className="w-24 h-20 shrink-0 select-none"
        data-testid="pixel-mentor-mini"
      >
        <svg
          viewBox="16 14 48 36"
          shapeRendering="crispEdges"
          className="w-full h-full pixel-crisp"
          role="img"
          aria-label={`Mikko wearing ${styleId}`}
        >
          <rect x="16" y="14" width="48" height="36" fill="#d5e4da" />
          <rect x="16" y="42" width="48" height="8" fill="#6f451f" />
          <g transform={`translate(${bodyX}, ${bodyY})`}>
            <rect x="33" y="34" width="14" height="8" fill={coatColor} />
            <rect x="38" y="34" width="4" height="6" fill="#f5f8f6" />
            <rect x="39" y="35" width="2" height="5" fill="#112218" />
          </g>
          <g transform={`translate(${bodyX + headX}, ${headY})`}>
            <rect x="38" y="32" width="4" height="2" fill="#e6b89c" />
            <rect x="34" y="23" width="12" height="9" fill="#f3cbb1" />
            <rect x="34" y="22" width="12" height="2" fill="#3a2d28" />
            {renderCosmetic(styleId, 34, 22)}
            {renderEyes(styleId, mood, isBlinking, 34, 23, eyeDirX, eyeDirY)}
            <rect x="38" y="30" width="4" height="1" fill="#9a5c47" />
          </g>
        </svg>
      </div>
    );
  }

  // Room down to the desk edge (80 x 72 of the 80 x 164 grid), anchored to the
  // bottom of its box so Mikko always sits right above the dialogue. Extra
  // height shows more wall; extra width is filled by the matching bands below.
  return (
    <div
      className="absolute inset-0 pointer-events-none select-none overflow-hidden"
      data-testid="pixel-mentor"
      data-thinking={thinking ? 'true' : 'false'}
      data-search-phase={searchPhase}
      data-mood={mood}
      data-question={hasQuestion ? 'true' : 'false'}
      data-style={styleId}
      style={{
        background:
          'linear-gradient(to bottom, #d7e5dc 0%, #d7e5dc 80.5%, #b7cbbd 80.5%, #b7cbbd 83.4%, #c5d6cb 83.4%, #c5d6cb 84.7%, #8b5a2b 84.7%, #8b5a2b 90.3%, #543314 90.3%, #543314 93%, #6f451f 93%)',
      }}
    >
      <svg
        viewBox="0 0 80 72"
        preserveAspectRatio="xMidYMax meet"
        shapeRendering="crispEdges"
        className="w-full h-full pixel-crisp"
        role="img"
        aria-label={`Mikko the financial coach (${mood}${searchPhase === 'grabbing' ? ', grabbing laptop' : searchPhase === 'searching' ? ', searching on tilted laptop' : ''})`}
      >
        {/* Wall & Wainscoting */}
        <rect x="0" y="0" width="80" height="72" fill="#d7e5dc" />
        <rect x="0" y="58" width="80" height="2" fill="#b7cbbd" />
        <rect x="0" y="60" width="80" height="12" fill="#c5d6cb" />

        {/* Left Pixel Window (Helsinki skyline silhouette) */}
        <rect x="6" y="18" width="18" height="22" fill="#8ea797" />
        <rect x="8" y="20" width="14" height="18" fill="#bae6fd" />
        <rect x="8" y="30" width="4" height="8" fill="#64748b" />
        <rect x="13" y="27" width="5" height="11" fill="#475569" />
        <rect x="19" y="32" width="3" height="6" fill="#64748b" />
        <rect x="8" y="28" width="14" height="1" fill="#8ea797" />
        <rect x="14" y="20" width="1" height="18" fill="#8ea797" />

        {/* Right Framed Wall Chart */}
        <rect x="57" y="18" width="17" height="14" fill="#8ea797" />
        <rect x="59" y="20" width="13" height="10" fill="#f8fafc" />
        <rect x="61" y="26" width="2" height="3" fill="#00a859" />
        <rect x="64" y="24" width="2" height="5" fill="#00a859" />
        <rect x="67" y="21" width="2" height="8" fill={highSlips ? '#c25e00' : '#007a45'} />

        {/* Mood Bubble Icon above/right of Mikko */}
        {hasQuestion && (
          <g transform={`translate(0, ${stepOdd ? -1 : 0})`}>
            <rect x="53" y="32" width="9" height="10" fill="#112218" />
            <rect x="54" y="33" width="7" height="8" fill="#fef08a" />
            <rect x="56" y="34" width="3" height="1" fill="#112218" />
            <rect x="58" y="35" width="1" height="1" fill="#112218" />
            <rect x="57" y="36" width="1" height="2" fill="#112218" />
            <rect x="57" y="39" width="1" height="1" fill="#112218" />
          </g>
        )}
        {mood === 'bluff_caught' && (
          <g transform={`translate(0, ${stepOdd ? -1 : 0})`}>
            <rect x="53" y="32" width="9" height="10" fill="#112218" />
            <rect x="54" y="33" width="7" height="8" fill="#fecaca" />
            <rect x="57" y="34" width="2" height="4" fill="#b91c1c" />
            <rect x="57" y="39" width="2" height="1" fill="#b91c1c" />
          </g>
        )}
        {(mood === 'impressed' || mood === 'level_up') && (
          <g transform={`translate(0, ${stepOdd ? -1 : 1})`}>
            <rect x="54" y="33" width="8" height="8" fill="#007a45" />
            <rect x="57" y="34" width="2" height="6" fill="#fde047" />
            <rect x="55" y="36" width="6" height="2" fill="#fde047" />
          </g>
        )}

        {/* MIKKO (Large Hero Mentor behind desk) */}
        <g transform={`translate(${bodyX}, ${bodyY})`}>
          {/* Shoulders & Coat */}
          <rect x="29" y="48" width="22" height="15" fill={coatColor} />
          <rect x="30" y="48" width="20" height="2" fill={coatTrim} />
          <rect x="37" y="48" width="6" height="11" fill="#f8fafc" />
          <rect x="39" y="50" width="2" height="9" fill="#112218" />
          {styleId === 'detective_coat' && (
            <>
              <rect x="34" y="48" width="3" height="6" fill="#8e6b3a" />
              <rect x="43" y="48" width="3" height="6" fill="#8e6b3a" />
            </>
          )}

          {/* Arms per Pose. Grab or type while he searches. */}
          {searchPhase === 'grabbing' && (
            <>
              <rect
                x={grabStep === 0 ? 49 : 46}
                y={grabStep === 0 ? 51 : 52}
                width={grabStep === 0 ? 9 : 7}
                height="4"
                fill={coatColor}
              />
              <rect
                x={grabStep === 0 ? 57 : 51}
                y={grabStep === 0 ? 53 : 54}
                width="4"
                height="4"
                fill="#f3cbb1"
              />
            </>
          )}

          {searchPhase === 'searching' && (
            <>
              <rect x="26" y="52" width="7" height="6" fill={coatColor} />
              <rect x="47" y="52" width="7" height="6" fill={coatColor} />
            </>
          )}

          {searchPhase === 'idle' && (mood === 'impressed' || mood === 'level_up') && (
            <>
              <rect x="24" y={stepOdd ? 35 : 38} width="5" height="14" fill={coatColor} />
              <rect x="24" y={stepOdd ? 32 : 35} width="5" height="3" fill="#f3cbb1" />
              <rect x="51" y={stepOdd ? 35 : 38} width="5" height="14" fill={coatColor} />
              <rect x="51" y={stepOdd ? 32 : 35} width="5" height="3" fill="#f3cbb1" />
            </>
          )}

          {searchPhase === 'idle' && mood === 'bluff_caught' && (
            <>
              <rect x="29" y="53" width="22" height="4" fill={coatTrim} />
              <rect x="33" y="53" width="4" height="3" fill="#f3cbb1" />
              <rect x="43" y="53" width="4" height="3" fill="#f3cbb1" />
            </>
          )}

          {searchPhase === 'idle' && mood === 'suspicious' && (
            <g transform={`translate(0, ${stepOdd ? -1 : 0})`}>
              {/* Left arm holding magnifying glass */}
              <rect x="24" y="46" width="5" height="9" fill={coatColor} />
              <rect x="22" y="41" width="3" height="6" fill="#7c5c30" />
              <rect x="19" y="33" width="9" height="8" fill="#112218" />
              <rect x="21" y="35" width="5" height="4" fill="#bae6fd" />
              <rect x="22" y="35" width="1" height="2" fill="#ffffff" />
            </g>
          )}
        </g>

        {/* Mikko's Head */}
        <g transform={`translate(${bodyX + headX}, ${headY})`}>
          <rect x="37" y="45" width="6" height="3" fill="#e6b89c" />
          <rect x="31" y="30" width="18" height="15" fill="#f3cbb1" />
          <rect x="29" y="36" width="2" height="4" fill="#e6b89c" />
          <rect x="49" y="36" width="2" height="4" fill="#e6b89c" />
          {/* Hair */}
          <rect x="31" y="28" width="18" height="3" fill="#3a2d28" />
          <rect x="31" y="31" width="2" height="4" fill="#3a2d28" />
          <rect x="47" y="31" width="2" height="4" fill="#3a2d28" />

          {/* Cosmetics scaled for hero head */}
          {styleId === 'classic_visor' && (
            <>
              <rect x="31" y="26" width="18" height="3" fill="#007a45" />
              <rect x="29" y="29" width="22" height="2" fill="#00a859" />
              <rect x="37" y="26" width="6" height="2" fill="#ffffff" />
            </>
          )}
          {styleId === 'detective_coat' && (
            <>
              <rect x="32" y="23" width="16" height="5" fill="#8e6b3a" />
              <rect x="28" y="28" width="24" height="2" fill="#6b4e27" />
              <rect x="32" y="26" width="16" height="2" fill="#3b2b16" />
            </>
          )}
          {styleId === 'sauna_beanie' && (
            <>
              <rect x="37" y="20" width="6" height="3" fill="#f8fafc" />
              <rect x="31" y="23" width="18" height="5" fill="#15803d" />
              <rect x="30" y="28" width="20" height="3" fill="#e2e8f0" />
            </>
          )}
          {styleId === 'golden_crown' && (
            <>
              <rect x="32" y="21" width="3" height="5" fill="#eab308" />
              <rect x="38" y="20" width="4" height="6" fill="#facc15" />
              <rect x="45" y="21" width="3" height="5" fill="#eab308" />
              <rect x="32" y="25" width="16" height="3" fill="#ca8a04" />
              <rect x="38" y="25" width="4" height="2" fill="#00a859" />
            </>
          )}

          {/* Eyes */}
          {styleId === 'eight_bit_shades' ? (
            <>
              <rect x="33" y="35" width="6" height="3" fill="#111827" />
              <rect x="41" y="35" width="6" height="3" fill="#111827" />
              <rect x="39" y="35" width="2" height="2" fill="#111827" />
              <rect x="34" y="35" width="2" height="1" fill="#ffffff" />
              <rect x="42" y="35" width="2" height="1" fill="#ffffff" />
            </>
          ) : isBlinking ? (
            <>
              <rect x="34" y="37" width="4" height="1" fill="#3a2d28" />
              <rect x="42" y="37" width="4" height="1" fill="#3a2d28" />
            </>
          ) : (
            <>
              <rect x="34" y="35" width="4" height="3" fill="#ffffff" />
              <rect x="42" y="35" width="4" height="3" fill="#ffffff" />
              <rect x={35 + eyeDirX} y={36 + eyeDirY} width="2" height="2" fill="#112218" />
              <rect x={43 + eyeDirX} y={36 + eyeDirY} width="2" height="2" fill="#112218" />
              {mood === 'bluff_caught' ? (
                <>
                  <rect x="33" y="33" width="3" height="1" fill="#3a2d28" />
                  <rect x="36" y="34" width="2" height="1" fill="#3a2d28" />
                  <rect x="44" y="33" width="3" height="1" fill="#3a2d28" />
                  <rect x="42" y="34" width="2" height="1" fill="#3a2d28" />
                </>
              ) : (
                <>
                  <rect x="34" y="34" width="4" height="1" fill="#3a2d28" />
                  <rect x="42" y="34" width="4" height="1" fill="#3a2d28" />
                </>
              )}
            </>
          )}

          {/* Mouth */}
          {mood === 'impressed' || mood === 'level_up' ? (
            <>
              <rect x="37" y="41" width="6" height="2" fill="#9a5c47" />
              <rect x="36" y="40" width="1" height="2" fill="#9a5c47" />
              <rect x="43" y="40" width="1" height="2" fill="#9a5c47" />
            </>
          ) : mood === 'bluff_caught' ? (
            <>
              <rect x="37" y="41" width="6" height="2" fill="#7c2d12" />
              <rect x="36" y="42" width="1" height="1" fill="#7c2d12" />
            </>
          ) : (
            <rect x="37" y="41" width="6" height="2" fill="#9a5c47" />
          )}
        </g>

        {/* Foreground Wooden Desk & Lower Floor */}
        <rect x="0" y="61" width="80" height="4" fill="#8b5a2b" />
        <rect x="0" y="65" width="80" height="2" fill="#543314" />
        <rect x="0" y="67" width="80" height="97" fill="#6f451f" />

        {/* Desk Props Left & Right */}
        {highSlips ? (
          <g>
            <rect x="8" y="53" width="9" height="8" fill="#ffffff" />
            <rect x="10" y="55" width="5" height="1" fill="#94a3b8" />
            <rect x="10" y="58" width="4" height="1" fill="#94a3b8" />
            <rect x="12" y="50" width="7" height="4" fill="#f1f5f9" />
            <rect x="13" y="51" width="4" height="1" fill="#c25e00" />
          </g>
        ) : (
          <g>
            <rect x="10" y="56" width="6" height="5" fill="#b45309" />
            <rect x="9" y="55" width="8" height="1" fill="#d97706" />
            <rect x="12" y="50" width="2" height="5" fill="#15803d" />
            <rect x="9" y="48" width="3" height="3" fill="#22c55e" />
            <rect x="14" y="48" width="3" height="3" fill="#22c55e" />
            {streakWeeks >= 2 && (
              <rect x="12" y="45" width="2" height="3" fill="#fde047" />
            )}
          </g>
        )}

        {/* Coffee mug left-center so right side of desk stays open for laptop */}
        <rect x="20" y="56" width="5" height="5" fill="#007a45" />
        <rect x="25" y="57" width="2" height="3" fill="#007a45" />

        {/* Laptop on the right side when idle; grabbed & tilted (screen hidden) while searching */}
        {searchPhase === 'idle' && (
          <g data-testid="mikko-laptop" aria-hidden="true">
            <rect x="61" y="59" width="14" height="2" fill="#1e293b" />
            <rect x="62" y="57" width="12" height="2" fill="#334155" />
            <rect x="62" y="57" width="12" height="1" fill="#64748b" />
            <rect x="73" y="59" width="1" height="1" fill="#22c55e" />
          </g>
        )}

        {searchPhase === 'grabbing' && (
          <g data-testid="mikko-laptop" aria-hidden="true">
            {grabStep === 0 ? (
              <>
                <rect x="51" y="58" width="14" height="3" fill="#1e293b" />
                <rect x="52" y="55" width="12" height="3" fill="#334155" />
                <rect x="52" y="55" width="12" height="1" fill="#64748b" />
              </>
            ) : (
              <>
                <rect x="36" y="58" width="17" height="3" fill="#1e293b" />
                <rect x="37" y="51" width="15" height="3" fill="#475569" />
                <rect x="38" y="54" width="14" height="4" fill="#334155" />
                <rect x="51" y="52" width="1" height="5" fill="#64748b" />
              </>
            )}
          </g>
        )}

        {searchPhase === 'searching' && (
          <g data-testid="mikko-laptop" aria-hidden="true">
            {/* Desk base behind tilted lid */}
            <rect x="29" y="59" width="22" height="2" fill="#1e293b" />
            <rect x="30" y="58" width="20" height="1" fill="#475569" />
            {/* Tilted back-of-lid (screen faces Mikko, hidden from viewer) */}
            <rect x="28" y="46" width="21" height="3" fill="#475569" />
            <rect x="29" y="49" width="21" height="3" fill="#334155" />
            <rect x="30" y="52" width="21" height="3" fill="#334155" />
            <rect x="31" y="55" width="20" height="3" fill="#1e293b" />
            {/* Side bevel showing tilt angle */}
            <rect x="49" y="47" width="1" height="3" fill="#64748b" />
            <rect x="50" y="50" width="1" height="3" fill="#64748b" />
            <rect x="51" y="53" width="1" height="4" fill="#475569" />
            {/* Back-shell logo mark */}
            <rect x="38" y="50" width="3" height="2" fill="#94a3b8" />
            <rect x="39" y="52" width="1" height="1" fill="#cbd5e1" />
            {/* Typing hands behind the edges */}
            <rect x={26 + (tick % 2)} y={56 + (stepOdd ? 0 : 1)} width="3" height="3" fill="#f3cbb1" />
            <rect x={51 - (tick % 2)} y={56 + (stepOdd ? 1 : 0)} width="3" height="3" fill="#f3cbb1" />
          </g>
        )}

        {/* Pointing Arm Reaching Over Desk Toward Floating Chart Below */}
        {searchPhase === 'idle' && mood === 'pointing' && (
          <g transform={`translate(0, ${stepOdd ? 1 : 0})`}>
            <rect x="46" y="49" width="9" height="4" fill={coatColor} />
            <rect x="52" y="52" width="6" height="6" fill={coatColor} />
            <rect x="52" y="58" width="6" height="4" fill="#f3cbb1" />
            <rect x="54" y="62" width="3" height="3" fill="#f3cbb1" />
            {/* Animated downward arrow over desk */}
            <rect x="51" y="66" width="9" height="4" fill="#00a859" />
            <rect x="54" y="67" width="3" height="2" fill="#fde047" />
          </g>
        )}
      </svg>
    </div>
  );
}

function renderCosmetic(styleId: MentorStyleId, hx: number, hy: number) {
  if (styleId === 'classic_visor') {
    return (
      <>
        <rect x={hx} y={hy - 2} width="12" height="2" fill="#007a45" />
        <rect x={hx - 1} y={hy} width="14" height="1" fill="#00a859" />
      </>
    );
  }
  if (styleId === 'detective_coat') {
    return (
      <>
        <rect x={hx + 1} y={hy - 4} width="10" height="3" fill="#8e6b3a" />
        <rect x={hx - 2} y={hy - 1} width="16" height="1" fill="#6b4e27" />
      </>
    );
  }
  if (styleId === 'sauna_beanie') {
    return (
      <>
        <rect x={hx + 4} y={hy - 6} width="4" height="2" fill="#f8fafc" />
        <rect x={hx} y={hy - 4} width="12" height="3" fill="#15803d" />
      </>
    );
  }
  if (styleId === 'golden_crown') {
    return (
      <>
        <rect x={hx + 1} y={hy - 4} width="2" height="3" fill="#eab308" />
        <rect x={hx + 5} y={hy - 5} width="2" height="4" fill="#facc15" />
        <rect x={hx + 9} y={hy - 4} width="2" height="3" fill="#eab308" />
      </>
    );
  }
  return null;
}

function renderEyes(
  styleId: MentorStyleId,
  mood: MentorMood,
  isBlinking: boolean,
  hx: number,
  hy: number,
  dx: number,
  dy: number,
) {
  if (styleId === 'eight_bit_shades') {
    return (
      <>
        <rect x={hx + 1} y={hy + 3} width="4" height="2" fill="#111827" />
        <rect x={hx + 7} y={hy + 3} width="4" height="2" fill="#111827" />
        <rect x={hx + 5} y={hy + 3} width="2" height="1" fill="#111827" />
      </>
    );
  }
  if (isBlinking) {
    return (
      <>
        <rect x={hx + 2} y={hy + 4} width="2" height="1" fill="#3a2d28" />
        <rect x={hx + 8} y={hy + 4} width="2" height="1" fill="#3a2d28" />
      </>
    );
  }
  return (
    <>
      <rect x={hx + 2} y={hy + 3} width="2" height="2" fill="#ffffff" />
      <rect x={hx + 8} y={hy + 3} width="2" height="2" fill="#ffffff" />
      <rect x={hx + 2 + dx} y={hy + 3 + dy} width="1" height="1" fill="#112218" />
      <rect x={hx + 8 + dx} y={hy + 3 + dy} width="1" height="1" fill="#112218" />
      {mood === 'bluff_caught' && (
        <>
          <rect x={hx + 1} y={hy + 2} width="2" height="1" fill="#3a2d28" />
          <rect x={hx + 9} y={hy + 2} width="2" height="1" fill="#3a2d28" />
        </>
      )}
    </>
  );
}
