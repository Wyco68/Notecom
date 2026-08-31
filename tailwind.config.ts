import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Geist, loaded and self-hosted by next/font in app/layout.tsx, which
      // sets both variables on <html>. The system stack stays behind them as
      // the fallback for the swap window.
      fontFamily: {
        sans: ["var(--font-sans)", ...defaultTheme.fontFamily.sans],
        mono: ["var(--font-mono)", ...defaultTheme.fontFamily.mono],
      },
      // Named layers instead of the bare numbers that were accumulating
      // (z-30 for the backdrop, z-40 for the drawer, z-50 for a modal). The
      // order is the only thing that matters and it should be readable.
      zIndex: {
        backdrop: "30",
        sidebar: "40",
        modal: "50",
        toast: "60",
      },
      // Shadows carry the surface's own hue rather than neutral black, so a
      // raised panel in dark mode reads as depth instead of soot.
      boxShadow: {
        panel: "0 1px 2px rgb(9 14 22 / 0.10), 0 8px 24px -12px rgb(9 14 22 / 0.35)",
        "panel-dark": "0 1px 2px rgb(0 0 0 / 0.45), 0 12px 32px -16px rgb(0 0 0 / 0.65)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
