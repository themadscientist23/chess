export type Color = "w" | "b";
export type PieceType = "P" | "N" | "B" | "R" | "Q" | "K";

export interface Piece {
  type: PieceType;
  color: Color;
}

export type Cell = Piece | null;
export type Coord = readonly [number, number];

export interface CastlingRights {
  K: boolean;
  Q: boolean;
}

export interface GameState {
  board: Cell[][];
  sideToMove: Color;
  castling: { w: CastlingRights; b: CastlingRights };
  // square skipped by a pawn double-push; capture lands here (fen ep target).
  epTarget: Coord | null;
  halfmoveClock: number;
  fullmoveNumber: number;
}

const FILES = "abcdefgh";

export function opposite(c: Color): Color {
  return c === "w" ? "b" : "w";
}

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

export function coordToUci(c: Coord): string {
  const [r, col] = c;
  return `${FILES[col]!}${8 - r}`;
}

export function uciToCoord(s: string): Coord {
  const file = FILES.indexOf(s[0]!);
  const rank = Number(s[1]!);
  return [8 - rank, file] as const;
}

export function parseUciMove(uci: string): {
  from: Coord;
  to: Coord;
  promotion: PieceType | null;
} | null {
  const clean = uci.trim().split(" ").pop()!;
  if (!clean || clean === "(none)" || clean.length < 4) return null;
  const from = uciToCoord(clean.slice(0, 2));
  const to = uciToCoord(clean.slice(2, 4));
  const promo = clean[4]?.toLowerCase();
  const promotion =
    promo === "q"
      ? "Q"
      : promo === "r"
        ? "R"
        : promo === "b"
          ? "B"
          : promo === "n"
            ? "N"
            : null;
  return { from, to, promotion };
}

export function moveToUci(
  from: Coord,
  to: Coord,
  promotion?: PieceType | null,
): string {
  let uci = `${coordToUci(from)}${coordToUci(to)}`;
  if (promotion) {
    const m: Record<PieceType, string> = {
      Q: "q",
      R: "r",
      B: "b",
      N: "n",
      K: "",
      P: "",
    };
    uci += m[promotion] ?? "";
  }
  return uci;
}

export function applyUci(game: GameState, uci: string): GameState | null {
  const parsed = parseUciMove(uci);
  if (!parsed) return null;
  return makeMove(game, parsed.from, parsed.to, parsed.promotion ?? "Q");
}

export function initialGameState(): GameState {
  const board: Cell[][] = Array.from({ length: 8 }, () => Array<Cell>(8).fill(null));
  const back: PieceType[] = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  for (let c = 0; c < 8; c++) {
    board[0][c] = { type: back[c]!, color: "b" };
    board[7][c] = { type: back[c]!, color: "w" };
    board[1][c] = { type: "P", color: "b" };
    board[6][c] = { type: "P", color: "w" };
  }
  return {
    board,
    sideToMove: "w",
    castling: {
      w: { K: true, Q: true },
      b: { K: true, Q: true },
    },
    epTarget: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
  };
}

function cloneBoard(board: Cell[][]): Cell[][] {
  return board.map((row) => row.slice());
}

function findKing(board: Cell[][], color: Color): Coord | null {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p?.type === "K" && p.color === color) return [r, c];
    }
  }
  return null;
}

function rayAttack(
  board: Cell[][],
  tr: number,
  tc: number,
  dr: number,
  dc: number,
  color: Color,
  blockers: PieceType[],
): boolean {
  let r = tr + dr;
  let c = tc + dc;
  while (inBounds(r, c)) {
    const p = board[r][c];
    if (!p) {
      r += dr;
      c += dc;
      continue;
    }
    if (p.color !== color) return false;
    return blockers.includes(p.type);
  }
  return false;
}

// returns whether (tr,tc) is attacked by any piece of color `by`.
export function isAttacked(board: Cell[][], tr: number, tc: number, by: Color): boolean {
  if (by === "w") {
    if (tr + 1 < 8 && tc > 0) {
      const p = board[tr + 1][tc - 1];
      if (p?.type === "P" && p.color === "w") return true;
    }
    if (tr + 1 < 8 && tc + 1 < 8) {
      const p = board[tr + 1][tc + 1];
      if (p?.type === "P" && p.color === "w") return true;
    }
  } else {
    if (tr - 1 >= 0 && tc > 0) {
      const p = board[tr - 1][tc - 1];
      if (p?.type === "P" && p.color === "b") return true;
    }
    if (tr - 1 >= 0 && tc + 1 < 8) {
      const p = board[tr - 1][tc + 1];
      if (p?.type === "P" && p.color === "b") return true;
    }
  }

  const jumps: Coord[] = [
    [2, 1],
    [2, -1],
    [-2, 1],
    [-2, -1],
    [1, 2],
    [1, -2],
    [-1, 2],
    [-1, -2],
  ];
  for (const [dr, dc] of jumps) {
    const r = tr + dr;
    const c = tc + dc;
    if (!inBounds(r, c)) continue;
    const p = board[r][c];
    if (p?.type === "N" && p.color === by) return true;
  }

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = tr + dr;
      const c = tc + dc;
      if (!inBounds(r, c)) continue;
      const p = board[r][c];
      if (p?.type === "K" && p.color === by) return true;
    }
  }

  if (rayAttack(board, tr, tc, -1, 0, by, ["R", "Q"])) return true;
  if (rayAttack(board, tr, tc, 1, 0, by, ["R", "Q"])) return true;
  if (rayAttack(board, tr, tc, 0, -1, by, ["R", "Q"])) return true;
  if (rayAttack(board, tr, tc, 0, 1, by, ["R", "Q"])) return true;
  if (rayAttack(board, tr, tc, -1, -1, by, ["B", "Q"])) return true;
  if (rayAttack(board, tr, tc, -1, 1, by, ["B", "Q"])) return true;
  if (rayAttack(board, tr, tc, 1, -1, by, ["B", "Q"])) return true;
  if (rayAttack(board, tr, tc, 1, 1, by, ["B", "Q"])) return true;

  return false;
}

export function inCheck(board: Cell[][], color: Color): boolean {
  const k = findKing(board, color);
  if (!k) return false;
  return isAttacked(board, k[0], k[1], opposite(color));
}

function rayMoves(
  board: Cell[][],
  r: number,
  c: number,
  color: Color,
  dr: number,
  dc: number,
): Coord[] {
  const out: Coord[] = [];
  let nr = r + dr;
  let nc = c + dc;
  while (inBounds(nr, nc)) {
    const cell = board[nr][nc];
    if (!cell) {
      out.push([nr, nc]);
    } else {
      if (cell.color !== color) out.push([nr, nc]);
      break;
    }
    nr += dr;
    nc += dc;
  }
  return out;
}

function pawnPseudo(
  board: Cell[][],
  r: number,
  c: number,
  color: Color,
  ep: Coord | null,
): Coord[] {
  const out: Coord[] = [];
  const dir = color === "w" ? -1 : 1;
  const startRank = color === "w" ? 6 : 1;
  const oneR = r + dir;
  if (inBounds(oneR, c) && !board[oneR][c]) {
    out.push([oneR, c]);
    const twoR = r + 2 * dir;
    if (r === startRank && !board[twoR][c]) out.push([twoR, c]);
  }
  for (const dc of [-1, 1]) {
    const capR = r + dir;
    const capC = c + dc;
    if (!inBounds(capR, capC)) continue;
    const target = board[capR][capC];
    if (target && target.color !== color) out.push([capR, capC]);
  }
  if (ep) {
    const [er, ec] = ep;
    if (er === r + dir && Math.abs(ec - c) === 1) {
      const victim = board[r][ec];
      if (victim?.type === "P" && victim.color !== color) out.push([er, ec]);
    }
  }
  return out;
}

function kingPseudo(
  game: GameState,
  r: number,
  c: number,
  color: Color,
): Coord[] {
  const { board, castling } = game;
  const out: Coord[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const cell = board[nr][nc];
      if (!cell || cell.color !== color) out.push([nr, nc]);
    }
  }

  if (color === "w" && r === 7 && c === 4 && board[r][c]?.type === "K") {
    const rights = castling.w;
    if (
      rights.K &&
      !board[7][5] &&
      !board[7][6] &&
      board[7][7]?.type === "R" &&
      board[7][7]?.color === "w" &&
      !inCheck(board, "w") &&
      !isAttacked(board, 7, 5, "b") &&
      !isAttacked(board, 7, 6, "b")
    ) {
      out.push([7, 6]);
    }
    if (
      rights.Q &&
      !board[7][3] &&
      !board[7][2] &&
      !board[7][1] &&
      board[7][0]?.type === "R" &&
      board[7][0]?.color === "w" &&
      !inCheck(board, "w") &&
      !isAttacked(board, 7, 3, "b") &&
      !isAttacked(board, 7, 2, "b")
    ) {
      out.push([7, 2]);
    }
  }

  if (color === "b" && r === 0 && c === 4 && board[r][c]?.type === "K") {
    const rights = castling.b;
    if (
      rights.K &&
      !board[0][5] &&
      !board[0][6] &&
      board[0][7]?.type === "R" &&
      board[0][7]?.color === "b" &&
      !inCheck(board, "b") &&
      !isAttacked(board, 0, 5, "w") &&
      !isAttacked(board, 0, 6, "w")
    ) {
      out.push([0, 6]);
    }
    if (
      rights.Q &&
      !board[0][3] &&
      !board[0][2] &&
      !board[0][1] &&
      board[0][0]?.type === "R" &&
      board[0][0]?.color === "b" &&
      !inCheck(board, "b") &&
      !isAttacked(board, 0, 3, "w") &&
      !isAttacked(board, 0, 2, "w")
    ) {
      out.push([0, 2]);
    }
  }

  return out;
}

function pseudoForSquare(game: GameState, r: number, c: number): Coord[] {
  const piece = game.board[r][c];
  if (!piece || piece.color !== game.sideToMove) return [];

  const { type, color } = piece;
  const { board, epTarget } = game;

  if (type === "P") return pawnPseudo(board, r, c, color, epTarget);
  if (type === "N") {
    const out: Coord[] = [];
    const jumps: Coord[] = [
      [2, 1],
      [2, -1],
      [-2, 1],
      [-2, -1],
      [1, 2],
      [1, -2],
      [-1, 2],
      [-1, -2],
    ];
    for (const [dr, dc] of jumps) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const cell = board[nr][nc];
      if (!cell || cell.color !== color) out.push([nr, nc]);
    }
    return out;
  }
  if (type === "K") return kingPseudo(game, r, c, color);

  const dirs: Coord[] =
    type === "R"
      ? [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]
      : type === "B"
        ? [
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ]
        : [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ];

  const out: Coord[] = [];
  for (const [dr, dc] of dirs) out.push(...rayMoves(board, r, c, color, dr, dc));
  return out;
}

// all legal destination squares for the piece at (r,c).
export function legalTargets(game: GameState, r: number, c: number): Coord[] {
  const piece = game.board[r][c];
  if (!piece || piece.color !== game.sideToMove) return [];
  const side = game.sideToMove;
  return pseudoForSquare(game, r, c).filter((t) => {
    if (piece.type === "P" && (t[0] === 0 || t[0] === 7)) {
      return (["Q", "R", "B", "N"] as const).some((promo) => {
        const next = applyMoveUnchecked(game, [r, c], t, promo);
        return next && !inCheck(next.board, side);
      });
    }
    const next = applyMoveUnchecked(game, [r, c], t, "Q");
    return !!next && !inCheck(next.board, side);
  });
}

export function allLegalMoves(
  game: GameState,
): { from: Coord; to: Coord; promotion?: PieceType }[] {
  const moves: { from: Coord; to: Coord; promotion?: PieceType }[] = [];
  const side = game.sideToMove;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = game.board[r][c];
      if (!p || p.color !== side) continue;
      for (const t of pseudoForSquare(game, r, c)) {
        if (p.type === "P" && (t[0] === 0 || t[0] === 7)) {
          for (const promo of ["Q", "R", "B", "N"] as const) {
            const next = applyMoveUnchecked(game, [r, c], t, promo);
            if (next && !inCheck(next.board, side)) {
              moves.push({ from: [r, c], to: t, promotion: promo });
            }
          }
        } else {
          const next = applyMoveUnchecked(game, [r, c], t, "Q");
          if (next && !inCheck(next.board, side)) {
            moves.push({ from: [r, c], to: t });
          }
        }
      }
    }
  }
  return moves;
}

export type PlayStatus = "playing" | "checkmate" | "stalemate";

export function playStatus(game: GameState): PlayStatus {
  if (allLegalMoves(game).length > 0) return "playing";
  return inCheck(game.board, game.sideToMove) ? "checkmate" : "stalemate";
}

function doublePushEpTarget(
  fr: number,
  fc: number,
  tr: number,
  tc: number,
  piece: Piece,
): Coord | null {
  if (piece.type !== "P" || fc !== tc) return null;
  if (piece.color === "w" && fr === 6 && tr === 4) return [5, fc];
  if (piece.color === "b" && fr === 1 && tr === 3) return [2, fc];
  return null;
}

function updateCastlingRights(
  game: GameState,
  piece: Piece,
  fr: number,
  fc: number,
  tr: number,
  tc: number,
  captured: Cell,
): { w: CastlingRights; b: CastlingRights } {
  const w = { ...game.castling.w };
  const b = { ...game.castling.b };

  if (piece.type === "K") {
    if (piece.color === "w") {
      w.K = false;
      w.Q = false;
    } else {
      b.K = false;
      b.Q = false;
    }
  }
  if (piece.type === "R") {
    if (piece.color === "w") {
      if (fr === 7 && fc === 0) w.Q = false;
      if (fr === 7 && fc === 7) w.K = false;
    } else {
      if (fr === 0 && fc === 0) b.Q = false;
      if (fr === 0 && fc === 7) b.K = false;
    }
  }

  if (captured?.type === "R") {
    if (tr === 7 && tc === 0) w.Q = false;
    if (tr === 7 && tc === 7) w.K = false;
    if (tr === 0 && tc === 0) b.Q = false;
    if (tr === 0 && tc === 7) b.K = false;
  }

  return { w, b };
}

// applies a move without legality checks; `promotion` is used when a pawn reaches the back rank.
export function applyMoveUnchecked(
  game: GameState,
  from: Coord,
  to: Coord,
  promotion: PieceType = "Q",
): GameState | null {
  const [fr, fc] = from;
  const [tr, tc] = to;
  const piece = game.board[fr][fc];
  if (!piece) return null;

  const board = cloneBoard(game.board);
  const captured = board[tr][tc];
  const isEp =
    piece.type === "P" &&
    fc !== tc &&
    !captured &&
    game.epTarget &&
    tr === game.epTarget[0] &&
    tc === game.epTarget[1];

  board[fr][fc] = null;

  if (isEp) {
    board[fr][tc] = null;
  }

  let moving: Piece = piece;

  if (piece.type === "K" && Math.abs(tc - fc) === 2) {
    if (piece.color === "w" && tr === 7) {
      if (tc === 6) {
        board[7][7] = null;
        board[7][5] = { type: "R", color: "w" };
      } else if (tc === 2) {
        board[7][0] = null;
        board[7][3] = { type: "R", color: "w" };
      }
    } else if (piece.color === "b" && tr === 0) {
      if (tc === 6) {
        board[0][7] = null;
        board[0][5] = { type: "R", color: "b" };
      } else if (tc === 2) {
        board[0][0] = null;
        board[0][3] = { type: "R", color: "b" };
      }
    }
  }

  if (piece.type === "P" && (tr === 0 || tr === 7)) {
    moving = { type: promotion, color: piece.color };
  }

  board[tr][tc] = moving;

  const epNext = doublePushEpTarget(fr, fc, tr, tc, piece);

  const captureOrPawn = !!captured || isEp || piece.type === "P";
  const halfmoveClock = captureOrPawn ? 0 : game.halfmoveClock + 1;

  let fullmoveNumber = game.fullmoveNumber;
  if (game.sideToMove === "b") fullmoveNumber++;

  const castling = updateCastlingRights(game, piece, fr, fc, tr, tc, captured);

  return {
    board,
    sideToMove: opposite(game.sideToMove),
    castling,
    epTarget: epNext,
    halfmoveClock,
    fullmoveNumber,
  };
}

export function makeMove(
  game: GameState,
  from: Coord,
  to: Coord,
  promotion: PieceType = "Q",
): GameState | null {
  const side = game.sideToMove;
  const [fr, fc] = from;
  if (!legalTargets(game, fr, fc).some(([r, c]) => r === to[0] && c === to[1])) {
    return null;
  }
  const piece = game.board[fr][fc];
  const promo =
    piece?.type === "P" && (to[0] === 0 || to[0] === 7) ? promotion : "Q";
  const next = applyMoveUnchecked(game, from, to, promo);
  if (!next) return null;
  if (inCheck(next.board, side)) return null;
  return next;
}

export function toFen(game: GameState): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let row = "";
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = game.board[r][c];
      if (!p) {
        empty++;
      } else {
        if (empty) {
          row += String(empty);
          empty = 0;
        }
        const ch =
          p.type === "P"
            ? "p"
            : p.type === "N"
              ? "n"
              : p.type === "B"
                ? "b"
                : p.type === "R"
                  ? "r"
                  : p.type === "Q"
                    ? "q"
                    : "k";
        row += p.color === "w" ? ch.toUpperCase() : ch;
      }
    }
    if (empty) row += String(empty);
    rows.push(row);
  }

  const turn = game.sideToMove;
  let cast = "";
  if (game.castling.w.K) cast += "K";
  if (game.castling.w.Q) cast += "Q";
  if (game.castling.b.K) cast += "k";
  if (game.castling.b.Q) cast += "q";
  if (!cast) cast = "-";

  let ep = "-";
  if (game.epTarget) {
    ep = coordToUci(game.epTarget);
  }

  return `${rows.join("/")} ${turn} ${cast} ${ep} ${game.halfmoveClock} ${game.fullmoveNumber}`;
}

// one half-move in a saved game (uci + fen snapshots for replay / pgn).
export interface RecordedMove {
  uci: string;
  fenBefore: string;
  fenAfter: string;
}

export function applyUciSequence(start: GameState, ucis: readonly string[]): GameState | null {
  let g = start;
  for (const u of ucis) {
    const n = applyUci(g, u);
    if (!n) return null;
    g = n;
  }
  return g;
}

// replays the game state up to `moveIndex` half-moves (0 = start position).
export function replayToMove(start: GameState, ucis: readonly string[], moveIndex: number): GameState {
  const n = Math.max(0, Math.min(moveIndex, ucis.length));
  const applied = applyUciSequence(start, ucis.slice(0, n));
  return applied ?? start;
}

export function buildRecordedMove(game: GameState, next: GameState, uci: string): RecordedMove {
  return { uci, fenBefore: toFen(game), fenAfter: toFen(next) };
}

// minimal pgn with uci coordinate notation (no san).
export function buildCoordinatePgn(
  ucis: readonly string[],
  whiteName = "White",
  blackName = "Black",
): string {
  let t = `[White "${whiteName.replace(/"/g, '\\"')}"]\n[Black "${blackName.replace(/"/g, '\\"')}"]\n\n`;
  for (let i = 0; i < ucis.length; i += 2) {
    const num = i / 2 + 1;
    const w = ucis[i];
    const b = ucis[i + 1];
    t += `${num}. ${w ?? ""}${b ? ` ${b}` : ""} `;
  }
  return t.trim();
}
