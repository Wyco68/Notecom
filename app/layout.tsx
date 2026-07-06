import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

export const metadata: Metadata = {
  title: "LectureLens",
  description: "Lesson notes vault",
};

// Runs before paint, before React hydrates: sets the `dark` class from
// localStorage (falling back to OS preference) so there's no flash of the
// wrong theme on load.
const THEME_INIT_SCRIPT = `
(function () {
  var stored = localStorage.getItem("theme");
  var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", dark);
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-white text-gray-900 dark:bg-[#0d1117] dark:text-[#e6edf3]">
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
