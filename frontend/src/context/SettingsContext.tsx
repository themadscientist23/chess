import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface AppSettings {
  playerName: string;
  themeHue: number;
}

interface SettingsContextValue {
  settings: AppSettings;
  setPlayerName: (name: string) => void;
  setThemeHue: (hue: number) => void;
}

const STORAGE_KEY = "cloud-chess-settings-v1";

const defaultSettings: AppSettings = {
  playerName: "Player",
  themeHue: 220,
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

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
      themeHue:
        typeof parsed.themeHue === "number" && Number.isFinite(parsed.themeHue)
          ? Math.max(0, Math.min(360, Math.round(parsed.themeHue)))
          : defaultSettings.themeHue,
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

  const setPlayerName = (name: string) => {
    setSettings((prev) => ({ ...prev, playerName: name.trim() || "Player" }));
  };

  const setThemeHue = (hue: number) => {
    const normalized = Math.max(0, Math.min(360, Math.round(hue)));
    setSettings((prev) => ({ ...prev, themeHue: normalized }));
  };

  const value = useMemo(
    () => ({ settings, setPlayerName, setThemeHue }),
    [settings],
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
