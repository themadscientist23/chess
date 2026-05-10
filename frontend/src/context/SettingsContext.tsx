import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type DefaultOrientation = "white" | "black" | "auto";

export interface AppSettings {
  playerName: string;
  themeHue: number;
  engineDepth: number;
  defaultOrientation: DefaultOrientation;
  showMoveHints: boolean;
  highlightLastMove: boolean;
}

interface SettingsContextValue {
  settings: AppSettings;
  setPlayerName: (name: string) => void;
  setThemeHue: (hue: number) => void;
  setEngineDepth: (depth: number) => void;
  setDefaultOrientation: (o: DefaultOrientation) => void;
  setShowMoveHints: (v: boolean) => void;
  setHighlightLastMove: (v: boolean) => void;
  reset: () => void;
}

const STORAGE_KEY = "cloud-chess-settings-v1";

const ENGINE_DEPTH_MIN = 6;
const ENGINE_DEPTH_MAX = 22;

export const ENGINE_DEPTH_RANGE = {
  min: ENGINE_DEPTH_MIN,
  max: ENGINE_DEPTH_MAX,
} as const;

const defaultSettings: AppSettings = {
  playerName: "Player",
  themeHue: 220,
  engineDepth: 18,
  defaultOrientation: "auto",
  showMoveHints: true,
  highlightLastMove: true,
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const clampHue = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.max(0, Math.min(360, Math.round(n)))
    : defaultSettings.themeHue;

const clampDepth = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.max(ENGINE_DEPTH_MIN, Math.min(ENGINE_DEPTH_MAX, Math.round(n)))
    : defaultSettings.engineDepth;

const sanitizeOrientation = (v: unknown): DefaultOrientation =>
  v === "white" || v === "black" || v === "auto"
    ? v
    : defaultSettings.defaultOrientation;

const sanitizeBool = (v: unknown, fallback: boolean) =>
  typeof v === "boolean" ? v : fallback;

// reads settings from local storage; returns defaults on any failure.
function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;

    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      playerName:
        typeof parsed.playerName === "string" && parsed.playerName.trim()
          ? parsed.playerName
          : defaultSettings.playerName,
      themeHue: clampHue(parsed.themeHue),
      engineDepth: clampDepth(parsed.engineDepth),
      defaultOrientation: sanitizeOrientation(parsed.defaultOrientation),
      showMoveHints: sanitizeBool(parsed.showMoveHints, defaultSettings.showMoveHints),
      highlightLastMove: sanitizeBool(
        parsed.highlightLastMove,
        defaultSettings.highlightLastMove,
      ),
    };
  } catch {
    return defaultSettings;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // persists settings on every update.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const setPlayerName = useCallback((name: string) => {
    setSettings((prev) => ({ ...prev, playerName: name.trim() || "Player" }));
  }, []);

  const setThemeHue = useCallback((hue: number) => {
    setSettings((prev) => ({ ...prev, themeHue: clampHue(hue) }));
  }, []);

  const setEngineDepth = useCallback((depth: number) => {
    setSettings((prev) => ({ ...prev, engineDepth: clampDepth(depth) }));
  }, []);

  const setDefaultOrientation = useCallback((o: DefaultOrientation) => {
    setSettings((prev) => ({ ...prev, defaultOrientation: sanitizeOrientation(o) }));
  }, []);

  const setShowMoveHints = useCallback((v: boolean) => {
    setSettings((prev) => ({ ...prev, showMoveHints: !!v }));
  }, []);

  const setHighlightLastMove = useCallback((v: boolean) => {
    setSettings((prev) => ({ ...prev, highlightLastMove: !!v }));
  }, []);

  const reset = useCallback(() => {
    setSettings(defaultSettings);
  }, []);

  const value = useMemo(
    () => ({
      settings,
      setPlayerName,
      setThemeHue,
      setEngineDepth,
      setDefaultOrientation,
      setShowMoveHints,
      setHighlightLastMove,
      reset,
    }),
    [
      settings,
      setPlayerName,
      setThemeHue,
      setEngineDepth,
      setDefaultOrientation,
      setShowMoveHints,
      setHighlightLastMove,
      reset,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
