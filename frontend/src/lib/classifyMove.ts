import type { AnalysisResult, MultipvLine } from "../chess/stockfishAnalyze";

export type MoveQuality =
  | "brilliant"
  | "great"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

// centipawn-loss thresholds for each grade.
export const CLASSIFY_THRESHOLDS = {
  great: 10,
  excellent: 25,
  good: 60,
  inaccuracy: 150,
  mistake: 300,
} as const;

// signed score (cp) for the side to move in the analyzed position.
function scoreForSideToMove(line: MultipvLine | undefined): number {
  if (!line) return 0;
  if (line.mate != null) {
    const m = line.mate;
    return m > 0 ? 32_000 - m : -32_000 - Math.abs(m);
  }
  return line.cp ?? 0;
}

// approximate centipawn loss for the side that just moved.
// before: that side is to move; after: opponent is to move (so cp flips sign).
export function centipawnLoss(
  analysisBefore: AnalysisResult,
  analysisAfter: AnalysisResult,
): number {
  const rawBefore = scoreForSideToMove(analysisBefore.lines[0]);
  const rawAfterOpp = scoreForSideToMove(analysisAfter.lines[0]);
  return Math.max(0, rawBefore + rawAfterOpp);
}

export function classifyMove(params: {
  playedUci: string;
  bestmove: string | null;
  cpLoss: number;
}): MoveQuality {
  const { playedUci, bestmove, cpLoss } = params;
  const playedBest = bestmove != null && playedUci === bestmove;

  if (playedBest && cpLoss <= 0) return "brilliant";
  if (playedBest && cpLoss < CLASSIFY_THRESHOLDS.great) return "great";
  if (cpLoss < CLASSIFY_THRESHOLDS.great) return "great";
  if (cpLoss < CLASSIFY_THRESHOLDS.excellent) return "excellent";
  if (cpLoss < CLASSIFY_THRESHOLDS.good) return "good";
  if (cpLoss < CLASSIFY_THRESHOLDS.inaccuracy) return "inaccuracy";
  if (cpLoss < CLASSIFY_THRESHOLDS.mistake) return "mistake";
  return "blunder";
}
