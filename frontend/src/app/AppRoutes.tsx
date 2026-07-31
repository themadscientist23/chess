import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { PlayPage } from "../features/chess/PlayPage";
import { GamesPage } from "../features/games/GamesPage";
import { GameReviewPage } from "../features/review/GameReviewPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { StatsPage } from "../features/stats/StatsPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/play" replace />} />
        <Route path="/play" element={<PlayPage />} />
        <Route path="/games" element={<GamesPage />} />
        <Route path="/games/folder/:folderId" element={<Navigate to="/games" replace />} />
        <Route path="/games/:id" element={<GameReviewPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/stats" element={<StatsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
