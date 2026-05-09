import { useMemo } from "react";
import { lookupOpening } from "../../lib/openingsData";

export function useOpening(uciPlies: readonly string[]) {
  const key = uciPlies.join(" ");
  return useMemo(() => lookupOpening(uciPlies), [key]);
}
