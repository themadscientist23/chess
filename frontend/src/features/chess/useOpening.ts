import { useMemo } from "react";
import { lookupOpening } from "../../lib/openingsData";

export function useOpening(uciMoves: readonly string[]) {
  const key = uciMoves.join(" ");
  return useMemo(() => lookupOpening(uciMoves), [key]);
}
