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

export interface GameTag {
  id: number;
  name: string;
  isSystem: boolean;
  createdAt?: string;
  gameCount?: number;
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
  tags?: GameTag[];
}

export const gamesApi = {
  folders: () => api<{ folders: GameFolder[] }>("/games/folders"),

  createFolder: (name: string) =>
    api<{ folder: { id: number; name: string } }>("/games/folders", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  listGames: (opts?: { folderId?: number; tagIds?: number[] }) => {
    const params = new URLSearchParams();
    if (opts?.folderId != null) params.set("folderId", String(opts.folderId));
    if (opts?.tagIds && opts.tagIds.length > 0) {
      params.set("tagIds", opts.tagIds.join(","));
    }
    const qs = params.toString();
    return api<{ games: SavedGame[] }>(qs ? `/games?${qs}` : "/games");
  },

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

  addTagToGame: (gameId: number, tagId: number) =>
    api<{ ok: boolean }>(`/games/${gameId}/tags`, {
      method: "POST",
      body: JSON.stringify({ tagId }),
    }),

  removeTagFromGame: (gameId: number, tagId: number) =>
    api<{ ok: boolean }>(`/games/${gameId}/tags/${tagId}`, {
      method: "DELETE",
    }),

  // rename players on an imported game.
  updateGameNames: (
    id: number,
    names: { whiteName: string; blackName: string },
  ) =>
    api<{ ok: boolean }>(`/games/${id}`, {
      method: "PATCH",
      body: JSON.stringify(names),
    }),

  // delete an imported game.
  deleteGame: (id: number) =>
    api<{ ok: boolean }>(`/games/${id}`, {
      method: "DELETE",
    }),
};

export const tagsApi = {
  list: () => api<{ tags: GameTag[] }>("/tags"),

  create: (name: string) =>
    api<{ tag: GameTag }>("/tags", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  remove: (id: number) =>
    api<{ ok: boolean }>(`/tags/${id}`, {
      method: "DELETE",
    }),
};
