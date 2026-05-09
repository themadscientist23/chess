import type { Color, PieceType } from "./game";

import bk from "../assets/pieces/bk.svg";
import bq from "../assets/pieces/bq.svg";
import br from "../assets/pieces/br.svg";
import bb from "../assets/pieces/bb.svg";
import bn from "../assets/pieces/bn.svg";
import wk from "../assets/pieces/wk.svg";
import wq from "../assets/pieces/wq.svg";
import wr from "../assets/pieces/wr.svg";
import wb from "../assets/pieces/wb.svg";
import wn from "../assets/pieces/wn.svg";
import pawnPng from "../assets/pieces/pawn.png";

const byColor: Record<Color, Record<PieceType, string>> = {
  w: { K: wk, Q: wq, R: wr, B: wb, N: wn, P: pawnPng },
  b: { K: bk, Q: bq, R: br, B: bb, N: bn, P: pawnPng },
};

export function pieceImageSrc(color: Color, type: PieceType): string {
  return byColor[color][type];
}
