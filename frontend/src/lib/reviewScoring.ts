import type { AnalysisResult, MultipvLine } from "../chess/stockfishAnalyze";
import type { Color } from "../chess/game";

export type MoveGrade = "good" | "inaccuracy" | "mistake" | "blunder";

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

// grades a single move by its evaluation drop.
export function classifyByEvalDelta(delta: number): MoveGrade {
  if (delta < 60) return "good";
  if (delta < 150) return "inaccuracy";
  if (delta < 300) return "mistake";
  return "blunder";
}

// computes the (non-negative) eval delta for a move at the given index.
export function deltaForMove(evals: number[], moveIndex: number): number {
  const before = evals[moveIndex];
  const after = evals[moveIndex + 1];
  if (before == null || after == null) return 0;
  return Math.max(0, before + after);
}
