import type { AnalysisResult, MultipvLine } from "../chess/stockfishAnalyze";
import {
  applyUci,
  isAttacked,
  opposite,
  parseUciMove,
  type Cell,
  type Color,
  type GameState,
  type PieceType,
} from "../chess/game";
import { isSequenceInBook } from "./openingsData";

export type MoveGrade =
  | "book"
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder"
  | "miss";

export interface GradeMeta {
  label: string;
  glyph: string;
  description: string;
}

// human label, glyph, and one-line explanation for each grade.
export const GRADE_META: Record<MoveGrade, GradeMeta> = {
  book: {
    label: "Book",
    glyph: "📖",
    description: "Established opening theory.",
  },
  brilliant: {
    label: "Brilliant",
    glyph: "!!",
    description: "Engine-best move that sacrifices material and still wins.",
  },
  great: {
    label: "Great",
    glyph: "★",
    description: "The only move that saves or wins the position.",
  },
  best: {
    label: "Best",
    glyph: "✓",
    description: "The engine's top choice.",
  },
  excellent: {
    label: "Excellent",
    glyph: "✧",
    description: "Nearly best — within a few centipawns of the top move.",
  },
  good: {
    label: "Good",
    glyph: "·",
    description: "A solid move that keeps the balance.",
  },
  inaccuracy: {
    label: "Inaccuracy",
    glyph: "?!",
    description: "A small slip — better options existed.",
  },
  mistake: {
    label: "Mistake",
    glyph: "?",
    description: "Concedes real ground to the opponent.",
  },
  blunder: {
    label: "Blunder",
    glyph: "??",
    description: "Throws away the position.",
  },
  miss: {
    label: "Missed win",
    glyph: "⊘",
    description: "A winning line was available but not taken.",
  },
};

// formats a multipv line score from white's perspective.
// uci scores are relative to side-to-move; flip sign when black moves.
export function formatEngineScore(line: MultipvLine, sideToMove: Color): string {
  const sign = sideToMove === "w" ? 1 : -1;

  if (line.mate != null) {
    const mate = line.mate * sign;
    return mate >= 0 ? `M${Math.abs(mate)}` : `-M${Math.abs(mate)}`;
  }

  const p = ((line.cp ?? 0) * sign) / 100;
  if (Math.abs(p) < 0.005) return "0.00";
  return `${p > 0 ? "+" : ""}${p.toFixed(2)}`;
}

// sign of the score from white's pov (+/-/0) for color theming.
export function scoreSign(line: MultipvLine, sideToMove: Color): number {
  const sign = sideToMove === "w" ? 1 : -1;
  if (line.mate != null) return Math.sign(line.mate * sign);
  return Math.sign((line.cp ?? 0) * sign);
}

// top-line score as centipawns (side-to-move pov, used for grading deltas).
export function topScoreCp(result: AnalysisResult | null): number {
  if (!result?.lines[0]) return 0;
  const top = result.lines[0];
  if (top.mate != null) return top.mate > 0 ? 32_000 : -32_000;
  return top.cp ?? 0;
}

// piece values used for material / sacrifice math (in "pawns").
const PIECE_VALUE: Record<PieceType, number> = {
  P: 1,
  N: 3,
  B: 3,
  R: 5,
  Q: 9,
  K: 100,
};

// simple material count from a color's perspective. king excluded.
function materialFor(board: Cell[][], color: Color): number {
  let total = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r]?.[c];
      if (!p || p.color !== color || p.type === "K") continue;
      total += PIECE_VALUE[p.type];
    }
  }
  return total;
}

// least-valuable attacker's value on (r,c) for the given color, or Infinity.
function leastAttackerValue(
  board: Cell[][],
  r: number,
  c: number,
  by: Color,
): number {
  if (!isAttacked(board, r, c, by)) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  for (let rr = 0; rr < 8; rr++) {
    for (let cc = 0; cc < 8; cc++) {
      const p = board[rr]?.[cc];
      if (!p || p.color !== by) continue;
      // does this exact piece attack (r,c)?
      const stub: Cell[][] = board.map((row) => row.slice());
      stub[r]![c] = null;
      // temporarily remove the piece and re-check; if the square is still
      // attacked when this piece is gone, the piece wasn't the attacker.
      const savedPiece = stub[rr]![cc];
      stub[rr]![cc] = null;
      const stillAttacked = isAttacked(stub, r, c, by);
      stub[rr]![cc] = savedPiece;
      if (!stillAttacked) {
        min = Math.min(min, PIECE_VALUE[p.type]);
      }
    }
  }
  // fallback: if we couldn't isolate a single attacker (e.g. multiple), use the
  // cheapest piece the side has on the board as an upper bound.
  if (min === Number.POSITIVE_INFINITY) {
    for (let rr = 0; rr < 8; rr++) {
      for (let cc = 0; cc < 8; cc++) {
        const p = board[rr]?.[cc];
        if (p?.color === by && p.type !== "K") {
          min = Math.min(min, PIECE_VALUE[p.type]);
        }
      }
    }
  }
  return min;
}

// heuristic: did the given uci move sacrifice net material?
// true when the moving piece lands on a square attacked by an enemy piece of
// lower value, with insufficient defense to recoup — i.e. a real sac, not just
// an even trade or a defended exchange.
export function isSacrificeMove(before: GameState, uci: string): boolean {
  const parsed = parseUciMove(uci);
  if (!parsed) return false;

  const moving = before.board[parsed.from[0]]?.[parsed.from[1]];
  if (!moving) return false;

  const captured = before.board[parsed.to[0]]?.[parsed.to[1]];
  const capturedValue = captured ? PIECE_VALUE[captured.type] : 0;
  const movingValue = PIECE_VALUE[moving.type];

  const after = applyUci(before, uci);
  if (!after) return false;

  const enemy = opposite(moving.color);
  const [tr, tc] = parsed.to;

  // is the landing square attacked by the enemy?
  if (!isAttacked(after.board, tr, tc, enemy)) return false;

  const attackerValue = leastAttackerValue(after.board, tr, tc, enemy);

  // net material lost by mover if the enemy captures on the landing square.
  // defender may recapture, but that only recovers up to attackerValue.
  const isDefended = isAttacked(after.board, tr, tc, moving.color);
  const worstCase = movingValue - capturedValue;
  const bestCase = worstCase - (isDefended ? attackerValue : 0);

  // sacrifice: mover loses at least ~1 pawn of material in the exchange, and
  // it isn't a straightforward equal or favorable trade.
  return bestCase >= 1 && attackerValue < movingValue;
}

// true when the total material for the mover on the resulting board drops by
// at least this many pawns relative to before (independent of what the enemy
// still has). catches queen sacrifices that leave no obvious recapture.
export function materialDropForMover(before: GameState, uci: string): number {
  const parsed = parseUciMove(uci);
  if (!parsed) return 0;
  const moving = before.board[parsed.from[0]]?.[parsed.from[1]];
  if (!moving) return 0;
  const after = applyUci(before, uci);
  if (!after) return 0;
  const beforeMat = materialFor(before.board, moving.color);
  const afterMat = materialFor(after.board, moving.color);
  return Math.max(0, beforeMat - afterMat);
}

// input bundle for a rich classification pass.
export interface ClassifyInput {
  delta: number;
  matchedBest: boolean;
  cpBefore: number; // side-to-move perspective
  cpAfter: number; // new side-to-move perspective (opponent)
  bestCpAfterBest?: number | null; // if the best move had been played, from opponent pov
  gameBefore: GameState;
  uci: string;
  isBook: boolean;
}

// converts a mover-pov cp score into a "winning for mover" boolean band.
function isWinning(cp: number): boolean {
  return cp >= 250;
}
function isLosing(cp: number): boolean {
  return cp <= -250;
}

// grades a move using eval + engine-best match + board context. tiers are
// evaluated top-down; the first that fits wins.
export function classifyMoveQuality(input: ClassifyInput): MoveGrade {
  const { delta, matchedBest, cpBefore, cpAfter, gameBefore, uci, isBook } = input;

  // opening theory takes precedence in the early phase.
  if (isBook) return "book";

  // "miss": mover was clearly winning but plays a real mistake, throwing the
  // advantage away. mover-pov cp flips from winning to not-winning.
  const cpAfterMover = -cpAfter; // flip perspective back to mover
  if (isWinning(cpBefore) && !isWinning(cpAfterMover) && delta >= 150) {
    return "miss";
  }

  if (matchedBest) {
    // brilliant: engine-best AND involves a genuine material sacrifice AND
    // the resulting position is at least not losing for the mover. we don't
    // require "still winning" so that defensive brilliancies count too.
    if (!isLosing(cpAfterMover)) {
      const sac = isSacrificeMove(gameBefore, uci);
      const drop = materialDropForMover(gameBefore, uci);
      if (sac || drop >= 3) return "brilliant";
    }
    return "best";
  }

  // evaluation-loss ladder for everything else.
  if (delta < 15) return "excellent";
  if (delta < 40) return "great";
  if (delta < 90) return "good";
  if (delta < 180) return "inaccuracy";
  if (delta < 350) return "mistake";
  return "blunder";
}

// computes the (non-negative) eval delta between two consecutive cp scores.
// evals are stored side-to-move relative; consecutive entries alternate color,
// so a neutral move has before + after === 0.
export function deltaForMove(evals: number[], moveIndex: number): number {
  const before = evals[moveIndex];
  const after = evals[moveIndex + 1];
  if (before == null || after == null) return 0;
  return Math.max(0, before + after);
}

// ------ chess.com-style accuracy ------
//
// this is the algorithm published in chess.com's "how accuracy is calculated"
// article (and reverse-engineered by the community). in short:
//
//   1. convert every position's centipawn eval to a win% via a sigmoid,
//   2. per move, compute the drop in the mover's win% (loss_i),
//   3. map loss_i -> per-move accuracy via 103.17 * e^(-0.0435 * loss) - 3.17,
//   4. blend a *volatility-weighted mean* and a *harmonic mean* of those
//      per-move accuracies.
//
// the blend penalizes single blunders (via the harmonic mean) while giving
// critical, volatile positions more weight (via std-dev weighting). a plain
// arithmetic mean tends to over-report accuracy, which is what our previous
// implementation was doing.

// clamp cp before feeding the sigmoid so mate scores don't overflow it.
const WP_CP_CLAMP = 2000;

// sigmoid cp -> win% (0..100), mover-pov.
export function winPercent(cp: number): number {
  const c = Math.max(-WP_CP_CLAMP, Math.min(WP_CP_CLAMP, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

// per-move accuracy from win% loss, clamped to [0, 100].
export function moveAccuracyFromLoss(winPctLoss: number): number {
  const loss = Math.max(0, winPctLoss);
  return Math.max(
    0,
    Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669),
  );
}

function harmonicMean(vals: readonly number[]): number {
  if (vals.length === 0) return 0;
  const s = vals.reduce((a, v) => a + 1 / Math.max(v, 1), 0);
  return vals.length / s;
}

// std dev of a sliding window centered at `center`, radius `radius` (inclusive).
function windowStd(
  series: readonly number[],
  center: number,
  radius: number,
): number {
  const lo = Math.max(0, center - radius);
  const hi = Math.min(series.length - 1, center + radius);
  const w: number[] = [];
  for (let i = lo; i <= hi; i++) w.push(series[i]!);
  if (w.length <= 1) return 0;
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  const variance =
    w.reduce((a, b) => a + (b - mean) * (b - mean), 0) / w.length;
  return Math.sqrt(variance);
}

// chess.com-style accuracy for one side. input is the white-pov win% at every
// position 0..N; N = number of half-moves played. output is [0, 100] or null
// when the side made no moves.
export function sideAccuracy(
  winPctWhiteSeries: readonly number[],
  mover: "w" | "b",
): number | null {
  if (winPctWhiteSeries.length < 2) return null;

  // convert white-pov to mover-pov: for black, invert around 50.
  const sPovSeries =
    mover === "w"
      ? [...winPctWhiteSeries]
      : winPctWhiteSeries.map((v) => 100 - v);

  const accuracies: number[] = [];
  const weights: number[] = [];

  for (let i = 0; i < winPctWhiteSeries.length - 1; i++) {
    const moverIsWhite = i % 2 === 0;
    if ((mover === "w") !== moverIsWhite) continue;

    const before = sPovSeries[i]!;
    const after = sPovSeries[i + 1]!;
    const loss = Math.max(0, before - after);
    accuracies.push(moveAccuracyFromLoss(loss));

    // weight moves by the local volatility of the white-pov win% series.
    // higher volatility = more consequential moment = more weight.
    const std = windowStd(winPctWhiteSeries, i, 2);
    weights.push(Math.max(0.5, Math.min(12, std)));
  }

  if (accuracies.length === 0) return null;

  const wSum = weights.reduce((a, b) => a + b, 0);
  const weightedMean =
    wSum === 0
      ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length
      : accuracies.reduce((a, v, i) => a + v * weights[i]!, 0) / wSum;

  const harmonic = harmonicMean(accuracies);

  return (weightedMean + harmonic) / 2;
}

// is the move at `index` still inside opening theory? true iff the exact move
// sequence up to and including that index is either a known opening or a
// prefix of some longer known opening. this fixes the previous behavior where
// every deep-game move looked "in book" because a shorter ancestor was still
// known.
export function isMoveInBook(
  ucis: readonly string[],
  index: number,
  maxBookHalfMoves = 20,
): boolean {
  if (index < 0 || index >= ucis.length) return false;
  if (index >= maxBookHalfMoves) return false;
  return isSequenceInBook(ucis.slice(0, index + 1));
}

// ordered grades for legend / summaries.
export const GRADE_ORDER: readonly MoveGrade[] = [
  "book",
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
  "miss",
];

// higher = worse. mainly used to rank "least good" grades for summary.
export const GRADE_SEVERITY: Record<MoveGrade, number> = {
  book: 0,
  brilliant: 0,
  best: 0,
  great: 1,
  excellent: 2,
  good: 3,
  inaccuracy: 4,
  mistake: 5,
  miss: 5,
  blunder: 6,
};
