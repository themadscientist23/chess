const base = "/api";

// thin fetch wrapper with json + error normalization.
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    },
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const msg =
      data && typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : res.statusText;
    throw new Error(msg || `HTTP ${res.status}`);
  }

  return data as T;
}

export type SavedGameMode = "pvp" | "ai";

export interface GameFolder {
  id: number;
  name: string;
  isSystem: boolean;
  createdAt: string;
  gameCount: number;
}

export interface SavedGame {
  id: number;
  folderId: number;
  mode: SavedGameMode;
  whiteName: string;
  blackName: string;
  result: string;
  source: string;
  ucis: string[];
  prettyMoves: string[];
  createdAt: string;
}

export const gamesApi = {
  folders: () => api<{ folders: GameFolder[] }>("/games/folders"),

  createFolder: (name: string) =>
    api<{ folder: { id: number; name: string } }>("/games/folders", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  listGames: (folderId?: number) =>
    api<{ games: SavedGame[] }>(folderId ? `/games?folderId=${folderId}` : "/games"),

  getGame: (id: number) => api<{ game: SavedGame }>(`/games/${id}`),

  createGame: (payload: {
    folderId: number;
    mode: SavedGameMode;
    whiteName: string;
    blackName: string;
    result: string;
    source: string;
    ucis: string[];
    prettyMoves: string[];
  }) =>
    api<{ gameId: number }>("/games", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  moveGame: (id: number, folderId: number) =>
    api<{ ok: boolean }>(`/games/${id}/folder`, {
      method: "PATCH",
      body: JSON.stringify({ folderId }),
    }),
};
