import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Public Sans and JetBrains Mono, self-hosted by next/font in
      // app/layout.tsx, which sets both variables on <html>.
      fontFamily: {
        sans: ["var(--font-sans)", ...defaultTheme.fontFamily.sans],
        mono: ["var(--font-mono)", ...defaultTheme.fontFamily.mono],
      },
      // Named layers instead of the bare numbers that were accumulating
      // (z-30 for the backdrop, z-40 for the drawer, z-50 for a modal). The
      // order is the only thing that matters and it should be readable.
      // Every colour is a token from app/globals.css, so a class names a role
      // ("ink", "danger") and the light/dark values live in one place.
      colors: {
        paper: "rgb(var(--paper) / <alpha-value>)",
        cover: "rgb(var(--cover) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        "cover-line": "rgb(var(--cover-line) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-2": "rgb(var(--ink-2) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-strong": "rgb(var(--accent-strong) / <alpha-value>)",
        "accent-ink": "rgb(var(--accent-ink) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
      },
      zIndex: {
        backdrop: "30",
        sidebar: "40",
        modal: "50",
        toast: "60",
      },
      // One soft shadow for anything that floats over the page (dialogs,
      // toasts, menus). Tinted from the ink, never neutral black.
      boxShadow: {
        panel: "0 1px 2px rgb(var(--shadow) / 0.10), 0 12px 32px -12px rgb(var(--shadow) / 0.30)",
      },
      // The gradient set, defined per theme in app/globals.css: `chrome` for
      // the sidebar and the auth cover, `accent` for the primary action and
      // the brand, `wash` for the light that falls from the top of the page.
      backgroundImage: {
        chrome: "var(--grad-chrome)",
        "accent-grad": "var(--grad-accent)",
        wash: "var(--grad-wash)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
