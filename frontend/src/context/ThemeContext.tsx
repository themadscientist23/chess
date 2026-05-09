import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useSettings } from "./SettingsContext";

interface ThemeCtx {
  hue: number;
}

const ThemeContext = createContext<ThemeCtx>({ hue: 220 });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const hue = settings.themeHue;

  useEffect(() => {
    document.documentElement.style.setProperty("--cloud-hue", String(hue));
    document.documentElement.dataset.cloudPreset = "cloud";
  }, [hue]);

  const value = useMemo(() => ({ hue }), [hue]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeHue(): number {
  return useContext(ThemeContext).hue;
}
