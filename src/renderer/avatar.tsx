// Agent avatars, as Flock draws them: a flat little character in the
// agent's colour (a body, something on top, eyes, a mouth and cheeks), each
// part picked from the agent's id, so an agent always looks the same and
// two rarely look alike. While it works it bobs and blinks (style.css).
import React from "react";

// Agent logos: a glossy orb in the agent's colour with a small bot face.
// The colours are ttmi's shape colours; the face is picked from the agent's
// id so each agent keeps its own.
export const AGENT_COLORS = ["#7c5cff", "#2f8cf0", "#1fae6b", "#e0a400", "#f5762a", "#ff7eb6", "#ef4565"];

function hashOf(text: string) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

export function agentColor(agent: { id: string; color?: string }) {
  return agent.color ?? AGENT_COLORS[hashOf(agent.id) % AGENT_COLORS.length]!;
}

// A body shape, centred on (16, 18.4) and about 25 units across, the face
// drawn over it.
const AVATAR_BODIES = [
  // Round.
  (color: string) => <circle cx="16" cy="18.4" r="12.6" fill={color} />,
  // Rounded square.
  (color: string) => <rect x="3.8" y="6.4" width="24.4" height="24.2" rx="7.5" fill={color} />,
  // Hexagon, its corners softened by a stroke of its own colour.
  (color: string) => <polygon points="16,6.6 26.4,12.6 26.4,24.4 16,30.4 5.6,24.4 5.6,12.6" fill={color} stroke={color} strokeWidth="3" strokeLinejoin="round" />,
  // Egg.
  (color: string) => <ellipse cx="16" cy="18.6" rx="11.6" ry="12.8" fill={color} />,
  // Onigiri: a rounded triangle.
  (color: string) => <path d="M16 6.2 C19.4 6.2 30.4 25.2 29.2 28.4 C28.2 31 3.8 31 2.8 28.4 C1.6 25.2 12.6 6.2 16 6.2 Z" fill={color} />,
  // Ghost: round on top, a wavy hem.
  (color: string) => <path d="M3.6 18.4 A12.4 12.4 0 0 1 28.4 18.4 V28.6 Q26.33 31.2 24.27 28.6 Q22.2 26 20.13 28.6 Q18.07 31.2 16 28.6 Q13.93 26 11.87 28.6 Q9.8 31.2 7.73 28.6 Q5.67 26 3.6 28.6 Z" fill={color} />,
  // Flower: scalloped all round.
  (color: string) => (
    <g fill={color}>
      <circle cx="16" cy="18.4" r="10.4" />
      {Array.from({ length: 8 }, (_, index) => {
        const angle = (index / 8) * Math.PI * 2;
        return <circle key={index} cx={16 + Math.cos(angle) * 9.6} cy={18.4 + Math.sin(angle) * 9.6} r="3.4" />;
      })}
    </g>
  ),
];

// What sits on top: antenna, ears, sprout, horns, a tuft, or nothing.
const AVATAR_TOPPERS = [
  (color: string) => (
    <g>
      <path d="M16 8.5 V3.8" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="3.4" r="2.2" fill={color} />
    </g>
  ),
  (color: string) => (
    <g fill={color}>
      <circle cx="7.6" cy="9.4" r="3.6" />
      <circle cx="24.4" cy="9.4" r="3.6" />
    </g>
  ),
  () => (
    <g>
      <path d="M16 8.5 V5.2" stroke="#1fae6b" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 5.6 C16 3 18.4 1.6 21 2 C20.8 4.6 18.6 6 16 5.6 Z" fill="#2fd4a0" />
      <path d="M16 6.2 C16 4.2 14.2 3 12.2 3.3 C12.4 5.3 14 6.5 16 6.2 Z" fill="#2fd4a0" />
    </g>
  ),
  (color: string) => (
    <g fill={color}>
      <path d="M8.2 10.6 L6.4 3.6 L12.4 8.2 Z" strokeLinejoin="round" stroke={color} strokeWidth="1.2" />
      <path d="M23.8 10.6 L25.6 3.6 L19.6 8.2 Z" strokeLinejoin="round" stroke={color} strokeWidth="1.2" />
    </g>
  ),
  (color: string) => (
    <g fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <path d="M13.4 7.6 Q12.6 4.8 14.6 3.6" />
      <path d="M16 7.2 Q16 4.2 17.6 2.8" />
      <path d="M18.6 7.6 Q19.8 5.2 21.8 5" />
    </g>
  ),
  () => null,
];

// Eyes: ovals with a shine, happy arcs, big and round, or one big eye.
const AVATAR_EYES = [
  (ink: string) => (
    <>
      <ellipse cx="11.9" cy="17.6" rx="2.15" ry="2.7" fill={ink} />
      <ellipse cx="20.1" cy="17.6" rx="2.15" ry="2.7" fill={ink} />
      <circle cx="12.6" cy="16.6" r="0.75" fill="#ffffff" />
      <circle cx="20.8" cy="16.6" r="0.75" fill="#ffffff" />
    </>
  ),
  (ink: string) => (
    <g fill="none" stroke={ink} strokeWidth="1.7" strokeLinecap="round">
      <path d="M9.8 18.4 Q11.9 15.6 14 18.4" />
      <path d="M18 18.4 Q20.1 15.6 22.2 18.4" />
    </g>
  ),
  (ink: string) => (
    <>
      <circle cx="11.6" cy="17.4" r="3.1" fill="#ffffff" />
      <circle cx="20.4" cy="17.4" r="3.1" fill="#ffffff" />
      <circle cx="12.2" cy="17.8" r="1.7" fill={ink} />
      <circle cx="21" cy="17.8" r="1.7" fill={ink} />
    </>
  ),
  (ink: string) => (
    <>
      <circle cx="16" cy="16.8" r="4.4" fill="#ffffff" />
      <circle cx="16.6" cy="17.2" r="2.5" fill={ink} />
      <circle cx="17.4" cy="16.2" r="0.8" fill="#ffffff" />
    </>
  ),
];

// Mouths: a smile, a small "o", a cat's mouth.
const AVATAR_MOUTHS = [
  (ink: string) => <path d="M13.6 22.2 Q16 24.4 18.4 22.2" fill="none" stroke={ink} strokeWidth="1.5" strokeLinecap="round" />,
  (ink: string) => <ellipse cx="16" cy="23" rx="1.3" ry="1.5" fill={ink} />,
  (ink: string) => <path d="M13.4 22.2 Q14.7 23.8 16 22.4 Q17.3 23.8 18.6 22.2" fill="none" stroke={ink} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />,
];

// A dot on its corner: yellow while it or any of its workers works, or CI runs on one of its pull requests (busy),
// otherwise purple while its canvas has steps you have not heard.
export function AgentAvatar({ seed, color, size = 28, working = false, busy = false, unheard = 0 }: { seed: string; color: string; size?: number; working?: boolean; busy?: boolean; unheard?: number }) {
  // A flat little character in the agent's colour: a body shape, something
  // on top, eyes, a mouth and cheeks, each picked from the agent's id (its
  // own part of the hash), so an agent always looks the same and two rarely
  // look alike (7 × 6 × 4 × 3).
  const hash = hashOf(seed);
  const body = AVATAR_BODIES[hash % AVATAR_BODIES.length]!;
  const topper = AVATAR_TOPPERS[Math.floor(hash / 7) % AVATAR_TOPPERS.length]!;
  const eyes = AVATAR_EYES[Math.floor(hash / 42) % AVATAR_EYES.length]!;
  const mouth = AVATAR_MOUTHS[Math.floor(hash / 168) % AVATAR_MOUTHS.length]!;
  const ink = "#1d1a2b";
  return (
    <span className={`agent-avatar ${working ? "agent-avatar-working" : ""}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        {topper(color)}
        {body(color)}
        <g className="agent-avatar-eyes">{eyes(ink)}</g>
        {mouth(ink)}
        <ellipse cx="8.4" cy="21.6" rx="1.8" ry="1.1" fill="#ffffff" opacity="0.35" />
        <ellipse cx="23.6" cy="21.6" rx="1.8" ry="1.1" fill="#ffffff" opacity="0.35" />
      </svg>
      {busy ? <span className="agent-avatar-unheard agent-avatar-busy" title={`Working${unheard > 0 ? `; ${unheard} new ${unheard === 1 ? "step" : "steps"} on its canvas` : ""}`} />
        : unheard > 0 && <span className="agent-avatar-unheard" title={`${unheard} new ${unheard === 1 ? "step" : "steps"} on its canvas`} />}
    </span>
  );
}
