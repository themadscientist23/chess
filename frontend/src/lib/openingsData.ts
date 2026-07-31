// space-separated lowercase uci moves map to [eco code, opening name].
// curated mainstream openings up to ~6 half-moves; falls back to longest known prefix.
export const OPENINGS_BY_UCI: Record<string, readonly [string, string]> = {
  "": ["—", "Starting position"],

  // king's pawn
  e2e4: ["B00", "King's Pawn Opening"],
  "e2e4 e7e5": ["C20", "Open Game"],
  "e2e4 e7e5 g1f3": ["C40", "King's Knight Opening"],
  "e2e4 e7e5 g1f3 b8c6": ["C44", "King's Knight, Normal"],
  "e2e4 e7e5 g1f3 b8c6 f1b5": ["C60", "Ruy Lopez"],
  "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6": ["C68", "Ruy Lopez, Morphy Defense"],
  "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4": ["C70", "Ruy Lopez, Morphy"],
  "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6": ["C78", "Ruy Lopez, Closed"],
  "e2e4 e7e5 g1f3 b8c6 f1b5 g8f6": ["C65", "Ruy Lopez, Berlin Defense"],
  "e2e4 e7e5 g1f3 b8c6 f1c4": ["C50", "Italian Game"],
  "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5": ["C53", "Italian, Giuoco Piano"],
  "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6": ["C55", "Italian, Two Knights Defense"],
  "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 g1g5": ["C57", "Two Knights, Fried Liver lines"],
  "e2e4 e7e5 g1f3 b8c6 d2d4": ["C44", "Scotch Game"],
  "e2e4 e7e5 g1f3 g8f6": ["C42", "Petrov's Defense"],
  "e2e4 e7e5 g1f3 d7d6": ["C41", "Philidor Defense"],
  "e2e4 e7e5 f1c4": ["C23", "Bishop's Opening"],
  "e2e4 e7e5 b1c3": ["C25", "Vienna Game"],
  "e2e4 e7e5 f2f4": ["C30", "King's Gambit"],
  "e2e4 e7e5 f2f4 e5f4": ["C33", "King's Gambit Accepted"],
  "e2e4 e7e5 d2d4": ["C21", "Center Game"],

  // sicilian
  "e2e4 c7c5": ["B20", "Sicilian Defense"],
  "e2e4 c7c5 g1f3": ["B27", "Sicilian, Open"],
  "e2e4 c7c5 g1f3 d7d6": ["B50", "Sicilian, Modern"],
  "e2e4 c7c5 g1f3 d7d6 d2d4": ["B52", "Sicilian, Open Najdorf-bound"],
  "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6": ["B90", "Sicilian, Najdorf"],
  "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 b8c6": ["B56", "Sicilian, Classical"],
  "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 g7g6": ["B70", "Sicilian, Dragon"],
  "e2e4 c7c5 g1f3 b8c6": ["B30", "Sicilian, Old"],
  "e2e4 c7c5 g1f3 e7e6": ["B40", "Sicilian, French Variation"],
  "e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 a7a6": ["B40", "Sicilian, Kan"],
  "e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 b8c6": ["B44", "Sicilian, Taimanov"],
  "e2e4 c7c5 b1c3": ["B23", "Sicilian, Closed"],
  "e2e4 c7c5 c2c3": ["B22", "Sicilian, Alapin"],
  "e2e4 c7c5 f2f4": ["B21", "Sicilian, Grand Prix"],

  // french
  "e2e4 e7e6": ["C00", "French Defense"],
  "e2e4 e7e6 d2d4": ["C00", "French, Normal"],
  "e2e4 e7e6 d2d4 d7d5": ["C01", "French, Exchange-prone"],
  "e2e4 e7e6 d2d4 d7d5 e4e5": ["C02", "French, Advance"],
  "e2e4 e7e6 d2d4 d7d5 e4d5": ["C01", "French, Exchange"],
  "e2e4 e7e6 d2d4 d7d5 b1c3": ["C10", "French, Paulsen / Classical"],
  "e2e4 e7e6 d2d4 d7d5 b1d2": ["C03", "French, Tarrasch"],

  // caro-kann
  "e2e4 c7c6": ["B10", "Caro-Kann Defense"],
  "e2e4 c7c6 d2d4 d7d5": ["B12", "Caro-Kann, Main"],
  "e2e4 c7c6 d2d4 d7d5 b1c3": ["B15", "Caro-Kann, Classical"],
  "e2e4 c7c6 d2d4 d7d5 e4d5": ["B13", "Caro-Kann, Exchange"],
  "e2e4 c7c6 d2d4 d7d5 e4e5": ["B12", "Caro-Kann, Advance"],

  // pirc / modern / scandinavian / alekhine
  "e2e4 d7d6": ["B07", "Pirc Defense"],
  "e2e4 g7g6": ["B06", "Modern Defense"],
  "e2e4 d7d5": ["B01", "Scandinavian Defense"],
  "e2e4 d7d5 e4d5 d8d5": ["B01", "Scandinavian, Mieses-Kotroc"],
  "e2e4 g8f6": ["B02", "Alekhine's Defense"],

  // queen's pawn
  d2d4: ["D00", "Queen's Pawn Opening"],
  "d2d4 d7d5": ["D00", "Closed Game"],
  "d2d4 d7d5 c2c4": ["D06", "Queen's Gambit"],
  "d2d4 d7d5 c2c4 d5c4": ["D20", "Queen's Gambit Accepted"],
  "d2d4 d7d5 c2c4 e7e6": ["D30", "Queen's Gambit Declined"],
  "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6": ["D35", "QGD, Main"],
  "d2d4 d7d5 c2c4 c7c6": ["D10", "Slav Defense"],
  "d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4": ["D17", "Slav, Czech"],
  "d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 e2e3": ["D11", "Semi-Slav, Quiet"],
  "d2d4 d7d5 c2c4 e7e6 b1c3 c7c6": ["D43", "Semi-Slav"],
  "d2d4 d7d5 c1f4": ["D00", "London System"],
  "d2d4 d7d5 g1f3": ["D02", "Queen's Pawn, Symmetrical"],

  // indian
  "d2d4 g8f6": ["A45", "Indian Defense"],
  "d2d4 g8f6 c2c4": ["E00", "Indian, c4"],
  "d2d4 g8f6 c2c4 e7e6": ["E00", "Indian, Catalan-bound"],
  "d2d4 g8f6 c2c4 e7e6 g2g3": ["E01", "Catalan Opening"],
  "d2d4 g8f6 c2c4 e7e6 g1f3": ["E10", "Indian, Queen's Pawn"],
  "d2d4 g8f6 c2c4 e7e6 b1c3": ["E20", "Nimzo-Indian Defense"],
  "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4": ["E20", "Nimzo-Indian, Main"],
  "d2d4 g8f6 c2c4 e7e6 g1f3 b7b6": ["E12", "Queen's Indian Defense"],
  "d2d4 g8f6 c2c4 g7g6": ["E60", "King's Indian Defense"],
  "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7": ["E60", "King's Indian, Main"],
  "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4": ["E70", "King's Indian, Classical setup"],
  "d2d4 g8f6 c2c4 g7g6 b1c3 d7d5": ["D80", "Grünfeld Defense"],
  "d2d4 g8f6 c2c4 c7c5": ["A50", "Benoni Defense"],
  "d2d4 g8f6 c2c4 c7c5 d4d5 e7e6": ["A60", "Modern Benoni"],
  "d2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3": ["E15", "Queen's Indian, Fianchetto"],
  "d2d4 f7f5": ["A80", "Dutch Defense"],
  "d2d4 d7d5 c2c4 e7e6 b1c3 f8b4": ["E11", "Bogo-Indian-bound"],
  "d2d4 e7e6 c2c4 f7f5": ["A85", "Dutch, Classical"],

  // english + flank
  c2c4: ["A10", "English Opening"],
  "c2c4 e7e5": ["A20", "English, King's"],
  "c2c4 c7c5": ["A30", "English, Symmetrical"],
  "c2c4 g8f6": ["A15", "English, Anglo-Indian"],
  "c2c4 g7g6": ["A10", "English, Modern"],
  g1f3: ["A04", "Réti Opening"],
  "g1f3 d7d5": ["A06", "Réti, Symmetrical"],
  "g1f3 g8f6": ["A05", "Réti, King's Indian Attack-bound"],
  b2b3: ["A01", "Larsen's Opening"],
  b2b4: ["A00", "Sokolsky / Polish"],
  f2f4: ["A02", "Bird's Opening"],
  g2g3: ["A00", "Hungarian / King's Fianchetto"],
  "b1c3": ["A00", "Dunst Opening"],

  // odd / surprise
  "e2e4 b8c6": ["B00", "Nimzowitsch Defense"],
  "e2e4 a7a6": ["B00", "St. George Defense"],
  "e2e4 g7g6 d2d4 f8g7": ["B06", "Modern, Standard"],
};

// finds the longest known prefix of the played sequence.
export function lookupOpening(uciMoves: readonly string[]): { eco: string; name: string } {
  const key = uciMoves.map((p) => p.toLowerCase()).join(" ");

  const exact = OPENINGS_BY_UCI[key];
  if (exact) return { eco: exact[0], name: exact[1] };

  let best = "";
  for (const k of Object.keys(OPENINGS_BY_UCI)) {
    if (!k) continue;
    if (key === k || key.startsWith(`${k} `)) {
      if (k.length > best.length) best = k;
    }
  }

  if (best && OPENINGS_BY_UCI[best]) {
    const v = OPENINGS_BY_UCI[best]!;
    return { eco: v[0], name: v[1] };
  }

  return { eco: "—", name: "Out of book" };
}

// pre-computed key list to keep book membership lookups cheap.
const OPENING_KEYS = Object.keys(OPENINGS_BY_UCI).filter((k) => k.length > 0);

// returns true if `sequence` is still inside the opening book: either the
// exact sequence is a known opening, or some longer known opening starts
// with it as a prefix. this is the correct notion for "book move" checks —
// unlike `lookupOpening`, which only finds the longest known ancestor and
// therefore stays positive long after the game has actually left theory.
export function isSequenceInBook(uciMoves: readonly string[]): boolean {
  if (uciMoves.length === 0) return true;
  const seq = uciMoves.map((p) => p.toLowerCase()).join(" ");
  const seqWithSep = `${seq} `;
  for (const key of OPENING_KEYS) {
    if (key === seq) return true;
    if (key.startsWith(seqWithSep)) return true;
  }
  return false;
}
