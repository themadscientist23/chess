import { NavLink, Outlet } from "react-router-dom";
import styles from "./AppShell.module.css";
import pageStyles from "../../App.module.css";

export function AppShell() {
  return (
    <div className={pageStyles.page}>
      <div className={pageStyles.clouds} aria-hidden />
      <div className={pageStyles.glow} aria-hidden />

      <nav className={styles.nav} aria-label="Main">
        <span className={styles.brand}>Cloud Chess</span>
        <div className={styles.links}>
          <NavLink to="/play" className={({ isActive }) => (isActive ? styles.active : undefined)}>
            Play
          </NavLink>
          <NavLink to="/games" className={({ isActive }) => (isActive ? styles.active : undefined)}>
            Games
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? styles.active : undefined)}>
            Settings
          </NavLink>
          <NavLink to="/stats" className={({ isActive }) => (isActive ? styles.active : undefined)}>
            Stats
          </NavLink>
        </div>
      </nav>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
