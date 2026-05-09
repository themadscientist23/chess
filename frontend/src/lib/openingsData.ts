// space-separated lowercase uci plies map to [eco code, opening name].
export const OPENINGS_BY_UCI: Record<string, readonly [string, string]> = {
  "": ["—", "Starting position"],
  e2e4: ["B00", "King's Pawn Opening"],
  "e2e4 e7e5": ["C20", "Open Game"],
  "e2e4 c7c5": ["B20", "Sicilian Defense"],
  "e2e4 e7e5 g1f3": ["C40", "King's Knight Opening"],
  "e2e4 e7e5 g1f3 b8c6": ["C44", "Italian Game"],
  "e2e4 c7c5 g1f3": ["B27", "Sicilian, Open"],
  "d2d4": ["D00", "Queen's Pawn Opening"],
  "d2d4 d7d5": ["D06", "Closed Game"],
  "d2d4 g8f6": ["D02", "Indian Defense"],
  "c2c4": ["A10", "English Opening"],
  "g1f3": ["A04", "Réti Opening"],
  "e2e4 e7e5 f1c4": ["C50", "Italian Game, Bishop's Opening"],
  "e2e4 e7e5 f1c4 f8c5": ["C50", "Italian"],
  "e2e4 e7e5 g1f3 b8c6 f1b5": ["C60", "Ruy Lopez"],
  "e2e4 c7c5 g1f3 d7d6": ["B50", "Sicilian, Modern"],
  "e2e4 e7e5 f2f4": ["C30", "King's Gambit"],
};

// finds the longest known prefix of the played sequence.
export function lookupOpening(uciPlies: readonly string[]): { eco: string; name: string } {
  const key = uciPlies.map((p) => p.toLowerCase()).join(" ");
  const hit = OPENINGS_BY_UCI[key];
  if (hit) return { eco: hit[0], name: hit[1] };

  let best = "";
  for (const k of Object.keys(OPENINGS_BY_UCI)) {
    if (k && key.startsWith(k) && k.length > best.length) best = k;
  }

  if (best && OPENINGS_BY_UCI[best]) {
    const v = OPENINGS_BY_UCI[best]!;
    return { eco: v[0], name: `${v[1]} · further` };
  }

  return { eco: "—", name: "Out of book" };
}
