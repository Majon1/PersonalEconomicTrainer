// "Money buddy": a round coin character whose face reflects how your
// financial decisions look (happy / mild / angry). Plain inline SVG.

const BODY = {
  happy: { fill: "#f4c542", rim: "#d9a520", cheek: "#f59e8b" },
  mild: { fill: "#eec26a", rim: "#cfa04a", cheek: "#e9b08f" },
  angry: { fill: "#ef8a6f", rim: "#cf5f45", cheek: "#d9473a" },
};
const INK = "#2a2522";

function face(mood) {
  if (mood === "happy") {
    return `
      <path d="M38 50 q6 -8 12 0" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M70 50 q6 -8 12 0" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M40 68 q20 20 40 0" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M50 76 q10 6 20 0" fill="#e2584b" stroke="none"/>
      <path class="sparkle" d="M98 22 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#fff6c8" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`;
  }
  if (mood === "mild") {
    return `
      <circle cx="44" cy="52" r="4.5" fill="${INK}"/>
      <circle cx="76" cy="52" r="4.5" fill="${INK}"/>
      <path d="M36 40 l14 -2" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
      <path d="M70 36 q7 -5 14 0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
      <path d="M44 76 q8 -5 16 0 t16 0" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
      <path class="drop" d="M96 34 q5 8 0 12 q-5 -4 0 -12z" fill="#9fd3f2" stroke="${INK}" stroke-width="1.5"/>`;
  }
  return `
      <path d="M34 40 l16 7" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
      <path d="M86 40 l-16 7" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="44" cy="55" r="4.5" fill="${INK}"/>
      <circle cx="76" cy="55" r="4.5" fill="${INK}"/>
      <path d="M42 80 q18 -14 36 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
      <g class="steam" fill="none" stroke="#9a9a9a" stroke-width="3" stroke-linecap="round">
        <path d="M14 24 q-4 -6 0 -12 q4 -6 0 -12"/>
        <path d="M106 24 q-4 -6 0 -12 q4 -6 0 -12"/>
      </g>`;
}

/** SVG markup for the buddy in a given mood. */
export function avatarSvg(mood = "happy", size = 120, label = "") {
  const b = BODY[mood] || BODY.happy;
  return `<svg class="buddy buddy-${mood}" width="${size}" height="${size}" viewBox="0 -4 120 124" role="img"
    aria-label="${label || `Money buddy looks ${mood}`}">
    <g class="buddy-body">
      <circle cx="60" cy="62" r="50" fill="${b.rim}"/>
      <circle cx="60" cy="58" r="47" fill="${b.fill}" stroke="${INK}" stroke-width="3"/>
      <circle cx="60" cy="58" r="38" fill="none" stroke="${b.rim}" stroke-width="2" stroke-dasharray="4 5" opacity="0.8"/>
      <ellipse cx="34" cy="66" rx="7" ry="4.5" fill="${b.cheek}" opacity="0.7"/>
      <ellipse cx="86" cy="66" rx="7" ry="4.5" fill="${b.cheek}" opacity="0.7"/>
      ${face(mood)}
    </g>
  </svg>`;
}

export const MOOD_TEXT = {
  happy: { title: "Looking good!", line: "You're living within your means. Keep doing what you're doing." },
  mild: { title: "Not bad, but…", line: "Nothing dramatic, though there's room for smarter choices." },
  angry: { title: "Hey, not cool.", line: "Some of that money was needed for rent and bills." },
};
