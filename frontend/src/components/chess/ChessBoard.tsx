import { inCheck, playStatus, type Color, type Coord, type GameState, type PieceType } from "../../chess/game";
import { pieceImageSrc } from "../../chess/pieces";
import styles from "../../App.module.css";

function sameCoord(a: Coord | null, b: Coord): boolean {
  return a !== null && a[0] === b[0] && a[1] === b[1];
}

function findKing(board: GameState["board"], color: Color): Coord | null {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p?.type === "K" && p.color === color) return [r, c];
    }
  }
  return null;
}

const PROMOS: PieceType[] = ["Q", "R", "B", "N"];

export interface ChessBoardProps {
  game: GameState;
  selected: Coord | null;
  lastMove: { from: Coord; to: Coord } | null;
  highlights: Map<string, Coord>;
  onSquareClick: (r: number, c: number) => void;
  promote: { from: Coord; to: Coord } | null;
  onPromote: (p: PieceType) => void;
  interactive?: boolean;
  perspective?: Color;
}

export function ChessBoard({
  game,
  selected,
  lastMove,
  highlights,
  onSquareClick,
  promote,
  onPromote,
  interactive = true,
  perspective = "w",
}: ChessBoardProps) {
  const turn = game.sideToMove;
  const status = playStatus(game);
  const checkedKing =
    status === "playing" && inCheck(game.board, turn) ? findKing(game.board, turn) : null;

  const viewCoords: Coord[] = [];
  for (let vr = 0; vr < 8; vr++) {
    for (let vc = 0; vc < 8; vc++) {
      const r = perspective === "w" ? vr : 7 - vr;
      const c = perspective === "w" ? vc : 7 - vc;
      viewCoords.push([r, c]);
    }
  }

  return (
    <div className={styles.boardWrap}>
      <div className={styles.board} role="grid" aria-label="Chess board">
        {viewCoords.map(([r, c], idx) => {
            const cell = game.board[r]?.[c] ?? null;
            const light = (r + c) % 2 === 0;
            const isSel = sameCoord(selected, [r, c]);
            const isLast =
              lastMove && (sameCoord(lastMove.from, [r, c]) || sameCoord(lastMove.to, [r, c]));
            const isMoveHint = highlights.has(`${r},${c}`) && !isSel;
            const isKingCheck = checkedKing && sameCoord(checkedKing, [r, c]);
            const className = [
              styles.square,
              light ? styles.light : styles.dark,
              isSel ? styles.selected : "",
              isLast ? styles.lastMove : "",
              isMoveHint ? styles.moveHint : "",
              isKingCheck ? styles.inCheck : "",
            ]
              .filter(Boolean)
              .join(" ");

            // rank/file labels on the perimeter, respecting perspective.
            const viewRow = perspective === "w" ? r : 7 - r;
            const viewCol = perspective === "w" ? c : 7 - c;
            const showFile = viewRow === 7;
            const showRank = viewCol === 0;
            const fileChar = String.fromCharCode(97 + c);
            const rankChar = String(8 - r);
            const coordShade = light ? styles.coordDark : styles.coordLight;

            return (
              <button
                type="button"
                key={`${idx}-${r}-${c}`}
                className={className}
                aria-label={`Square ${fileChar}${rankChar}`}
                disabled={!interactive}
                onClick={() => interactive && onSquareClick(r, c)}
              >
                {showRank ? (
                  <span className={`${styles.coordRank} ${coordShade}`} aria-hidden>
                    {rankChar}
                  </span>
                ) : null}
                {showFile ? (
                  <span className={`${styles.coordFile} ${coordShade}`} aria-hidden>
                    {fileChar}
                  </span>
                ) : null}
                {cell ? (
                  <img
                    className={[
                      styles.pieceImg,
                      cell.color === "w" ? styles.pieceWhite : styles.pieceBlack,
                    ].join(" ")}
                    src={pieceImageSrc(cell.color, cell.type)}
                    alt=""
                    draggable={false}
                  />
                ) : null}
              </button>
            );
          })}
      </div>

      {promote ? (
        <div className={styles.promoteOverlay} role="dialog" aria-label="Choose promotion">
          <p className={styles.promoteLabel}>Promote to</p>
          <div className={styles.promoteRow}>
            {PROMOS.map((p) => (
              <button key={p} type="button" className={styles.promoteBtn} onClick={() => onPromote(p)}>
                <img src={pieceImageSrc(game.sideToMove, p)} alt="" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
