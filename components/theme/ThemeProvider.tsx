"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Always start at "dark" — matching the server's render, since the server
  // has no access to localStorage/the user's OS preference. The inline
  // script in app/layout.tsx already set the real class on <html> before
  // paint; this effect runs once after mount to pull React's state in line
  // with it, rather than guessing at it during the initial render (which is
  // what caused a hydration mismatch on anything that renders differently
  // per theme, e.g. ThemeToggle's icon).
  // Null until mounted: writing the class back before the real theme is read
  // flashed the dark theme over a light page on every load.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const actual = document.documentElement.classList.contains("dark") ? "dark" : "light";
    setTheme(actual);
  }, []);

  useEffect(() => {
    if (!theme) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  function toggle() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  return <ThemeContext.Provider value={{ theme: theme ?? "dark", toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
