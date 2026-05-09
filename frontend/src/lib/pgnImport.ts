import {
  allLegalMoves,
  coordToUci,
  initialGameState,
  makeMove,
  parseUciMove,
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

// extracts pgn tag pairs and the rest as movetext.
function splitPgn(raw: string): { tags: Record<string, string>; moveText: string } {
  const tags: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  const moveLines: string[] = [];
  const tagRe = /^\s*\[([A-Za-z0-9_]+)\s+"(.*)"\]\s*$/;

  for (const line of lines) {
    const m = line.match(tagRe);
    if (m) {
      tags[m[1]!] = m[2]!;
      continue;
    }
    moveLines.push(line);
  }

  return { tags, moveText: moveLines.join(" ") };
}

// strips comments, variations, and movetext result/number tokens.
function tokenizeMoves(moveText: string): string[] {
  const noComments = moveText
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\$\d+/g, " ");

  return noComments
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !/^\d+\.(\.\.)?$/.test(t))
    .filter((t) => !["1-0", "0-1", "1/2-1/2", "*"].includes(t));
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

// parses one full pgn into uci + pretty move arrays plus header tags.
export function parsePgnToGame(rawPgn: string): ParsedPgnGame {
  const { tags, moveText } = splitPgn(rawPgn);
  const tokens = tokenizeMoves(moveText);
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

  return {
    whiteName: tags.White?.trim() || "White",
    blackName: tags.Black?.trim() || "Black",
    result: tags.Result?.trim() || "Imported PGN",
    ucis,
    prettyMoves,
  };
}
