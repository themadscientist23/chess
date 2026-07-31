import {
  allLegalMoves,
  coordToUci,
  initialGameState,
  makeMove,
  parseUciMove,
  playStatus,
  type GameState,
  type PieceType,
} from "../chess/game";
import { prettyFromUci } from "./sanFormat";

interface ParsedPgnGame {
  whiteName: string;
  blackName: string;
  result: string;
  ucis: string[];
  prettyMoves: string[];
}

const RESULT_TOKEN = /^(?:1-0|0-1|1\/2-1\/2|\*)$/;

// extracts pgn tag pairs (case-insensitive keys) and the rest as movetext.
function splitPgn(raw: string): { tags: Record<string, string>; moveText: string } {
  const tags: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  const moveLines: string[] = [];
  // allow optional whitespace and both " and ” style quotes in the wild.
  const tagRe = /^\s*\[\s*([A-Za-z0-9_]+)\s+"([^"]*)"\s*\]\s*$/;

  for (const line of lines) {
    const m = line.match(tagRe);
    if (m) {
      // normalize common tag names so Result / result / RESULT all match.
      const lower = m[1]!.toLowerCase();
      const stored =
        lower === "white"
          ? "White"
          : lower === "black"
            ? "Black"
            : lower === "result"
              ? "Result"
              : m[1]!;
      tags[stored] = m[2]!;
      continue;
    }
    moveLines.push(line);
  }

  return { tags, moveText: moveLines.join(" ") };
}

// strips comments and (nested) variations, returning move tokens + any
// trailing result token found in the movetext.
function tokenizeMoves(moveText: string): { tokens: string[]; result: string | null } {
  // drop brace comments
  let s = moveText.replace(/\{[^}]*\}/g, " ");
  // drop nested parenthetical variations
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(/\([^()]*\)/g, " ");
  }
  // drop NAGs ($1, $3, …)
  s = s.replace(/\$\d+/g, " ");

  const raw = s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !/^\d+\.(\.\.)?$/.test(t));

  let result: string | null = null;
  const tokens: string[] = [];
  for (const t of raw) {
    if (RESULT_TOKEN.test(t)) {
      result = t;
      continue;
    }
    tokens.push(t);
  }
  return { tokens, result };
}

// resolves one san token to a uci move using the current legal-move set.
function sanToUci(game: GameState, sanToken: string): string | null {
  const san = sanToken.replace(/[+#?!]+$/g, "");

  if (san === "O-O" || san === "0-0") {
    const rank = game.sideToMove === "w" ? 7 : 0;
    return `${coordToUci([rank, 4])}${coordToUci([rank, 6])}`;
  }
  if (san === "O-O-O" || san === "0-0-0") {
    const rank = game.sideToMove === "w" ? 7 : 0;
    return `${coordToUci([rank, 4])}${coordToUci([rank, 2])}`;
  }

  const promoMatch = san.match(/=([QRBN])$/);
  const promotion = (promoMatch?.[1] as PieceType | undefined) ?? null;
  const core = san.replace(/=([QRBN])$/, "");
  const targetMatch = core.match(/([a-h][1-8])$/);
  if (!targetMatch) return null;

  const target = targetMatch[1]!;
  const pieceLetter = /^[KQRBN]/.test(core) ? core[0]! : "P";
  const hint = core
    .slice(pieceLetter === "P" ? 0 : 1, core.length - target.length)
    .replace("x", "");
  const hintFile = hint.match(/[a-h]/)?.[0] ?? null;
  const hintRank = hint.match(/[1-8]/)?.[0] ?? null;

  const candidates = allLegalMoves(game).filter((mv) => {
    const from = coordToUci(mv.from);
    const to = coordToUci(mv.to);
    if (to !== target) return false;

    const piece = game.board[mv.from[0]]?.[mv.from[1]];
    if (!piece || piece.type !== pieceLetter) return false;
    if (promotion && mv.promotion !== promotion) return false;
    if (hintFile && from[0] !== hintFile) return false;
    if (hintRank && from[1] !== hintRank) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  const chosen = candidates[0]!;
  const suffix = chosen.promotion ? chosen.promotion.toLowerCase() : "";
  return `${coordToUci(chosen.from)}${coordToUci(chosen.to)}${suffix}`;
}

// maps a raw PGN result token + terminal position into the same result copy
// the platform uses for finished games ("White wins · Checkmate", etc.).
function decodeResult(
  raw: string | null | undefined,
  end: GameState,
): string {
  const status = playStatus(end);
  const token = (raw ?? "").trim();

  if (status === "checkmate") {
    const winner = end.sideToMove === "w" ? "Black" : "White";
    return `${winner} wins · Checkmate`;
  }
  if (status === "stalemate") {
    return "Draw · Stalemate";
  }

  // unfinished / mid-game board — trust the PGN result tag/token if present.
  if (token === "1-0") return "White wins";
  if (token === "0-1") return "Black wins";
  if (token === "1/2-1/2") return "Draw";
  if (/^white\s+wins/i.test(token)) return token;
  if (/^black\s+wins/i.test(token)) return token;
  if (/^draw/i.test(token)) return token.startsWith("Draw") ? token : "Draw";

  // no usable signal — keep a clear unfinished marker (never "Imported PGN").
  if (!token || token === "*" || token.toLowerCase() === "imported pgn") {
    return "Unfinished";
  }
  return token;
}

// parses one full pgn into uci + pretty move arrays plus decoded headers.
export function parsePgnToGame(rawPgn: string): ParsedPgnGame {
  const { tags, moveText } = splitPgn(rawPgn);
  const { tokens, result: moveResult } = tokenizeMoves(moveText);
  if (tokens.length === 0) throw new Error("No moves found in PGN");

  let game = initialGameState();
  const ucis: string[] = [];
  const prettyMoves: string[] = [];

  for (const token of tokens) {
    const uci = sanToUci(game, token);
    if (!uci) throw new Error(`Could not parse move token: ${token}`);

    const pretty = prettyFromUci(game, uci);
    const parsed = parseUciMove(uci);
    if (!parsed) throw new Error(`Invalid generated move: ${uci}`);

    const next = makeMove(game, parsed.from, parsed.to, parsed.promotion ?? "Q");
    if (!next) throw new Error(`Illegal move in sequence: ${token}`);

    ucis.push(uci);
    prettyMoves.push(pretty);
    game = next;
  }

  const headerResult = tags.Result?.trim() ?? "";
  const rawResult =
    headerResult && headerResult !== "*"
      ? headerResult
      : moveResult && moveResult !== "*"
        ? moveResult
        : headerResult || moveResult || null;

  return {
    whiteName: tags.White?.trim() || "Imported White",
    blackName: tags.Black?.trim() || "Imported Black",
    result: decodeResult(rawResult, game),
    ucis,
    prettyMoves,
  };
}
