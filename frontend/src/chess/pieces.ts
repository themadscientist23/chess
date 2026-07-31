import type { Color, PieceType } from "./game";

// solid-silhouette PNGs (64x64) from icons8, one file per color/piece.
import bk from "../assets/chess_icons/black_king.png";
import bq from "../assets/chess_icons/black_queen.png";
import br from "../assets/chess_icons/black_rook.png";
import bb from "../assets/chess_icons/black_bishop.png";
import bn from "../assets/chess_icons/black_knight.png";
import bp from "../assets/chess_icons/black_pawn.png";
import wk from "../assets/chess_icons/white_king.png";
import wq from "../assets/chess_icons/white_queen.png";
import wr from "../assets/chess_icons/white_rook.png";
import wb from "../assets/chess_icons/white_bishop.png";
import wn from "../assets/chess_icons/white_knight.png";
import wp from "../assets/chess_icons/white_pawn.png";

const byColor: Record<Color, Record<PieceType, string>> = {
  w: { K: wk, Q: wq, R: wr, B: wb, N: wn, P: wp },
  b: { K: bk, Q: bq, R: br, B: bb, N: bn, P: bp },
};

export function pieceImageSrc(color: Color, type: PieceType): string {
  return byColor[color][type];
}
