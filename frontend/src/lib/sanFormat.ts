import {
  applyUci,
  coordToUci,
  parseUciMove,
  type GameState,
} from "../chess/game";

// converts one uci move to short algebraic (e.g. d4, exd5, Nf3, O-O).
export function prettyFromUci(game: GameState, uci: string): string {
  const parsed = parseUciMove(uci);
  if (!parsed) return uci;

  const piece = game.board[parsed.from[0]]?.[parsed.from[1]];
  if (!piece) return uci;

  const fromUci = coordToUci(parsed.from);
  const to = coordToUci(parsed.to);
  const target = game.board[parsed.to[0]]?.[parsed.to[1]];
  const capture =
    !!target || (piece.type === "P" && parsed.from[1] !== parsed.to[1]);
  const promo = parsed.promotion ? `=${parsed.promotion}` : "";

  // king move two files = castle
  if (piece.type === "K" && Math.abs(parsed.from[1] - parsed.to[1]) === 2) {
    return parsed.to[1] === 6 ? "O-O" : "O-O-O";
  }

  if (piece.type === "P") {
    if (capture) return `${fromUci[0]!}x${to}${promo}`;
    return `${to}${promo}`;
  }

  return `${piece.type}${capture ? "x" : ""}${to}${promo}`;
}

// renders a uci pv as algebraic with move numbers from the given start state.
export function formatPvLine(start: GameState, pvUci: readonly string[]): string {
  if (pvUci.length === 0) return "";

  const out: string[] = [];
  let game = start;
  let fullmove = start.fullmoveNumber;
  let side = start.sideToMove;
  let firstToken = true;

  for (const uci of pvUci) {
    const san = prettyFromUci(game, uci);

    if (side === "w") {
      out.push(`${fullmove}. ${san}`);
    } else {
      out.push(firstToken ? `${fullmove}... ${san}` : san);
      fullmove += 1;
    }

    firstToken = false;
    side = side === "w" ? "b" : "w";

    const next = applyUci(game, uci);
    if (!next) break;
    game = next;
  }

  return out.join(" ");
}
