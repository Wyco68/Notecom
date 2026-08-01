import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

export const metadata: Metadata = {
  title: "Notecom",
  description: "Lesson notes vault",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* next/script's beforeInteractive strategy — still runs before body
            paint, same guarantee a flash-of-wrong-theme fix needs. No nonce
            prop: it's an external, same-origin file, already authorized by
            the CSP's script-src 'self' on its own.
            One known, harmless side effect of any nonce-based CSP: a
            "server rendered HTML didn't match" console warning naming
            `nonce` on this tag (and on Next's own internal beforeInteractive
            bootstrap script — reproduced with no nonce prop here at all, so
            it isn't specific to this file). Browsers clear a nonce
            attribute's DOM value once they've applied it; React's hydration
            diff compares against that cleared value and flags it, but the
            script has already executed by then — confirmed live (dev
            console, no CSP violation, dispatched a real input event and
            watched React's controlled state update). Cosmetic only. */}
        <Script src="/theme-init.js" strategy="beforeInteractive" />
      </head>
      <body className="bg-white text-gray-900 dark:bg-[#0d1117] dark:text-[#e6edf3]">
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
