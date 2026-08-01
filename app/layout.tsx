import type { Metadata } from "next";
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
        {/* A plain <script src>, not next/script: browsers already run a
            blocking head script (no async/defer) before body paint on their
            own, which is all a flash-of-wrong-theme fix needs — no framework
            guarantee required. This matters here specifically because
            next/script's `beforeInteractive` strategy renders its own
            internal nonce-carrying wrapper around whatever it loads, and
            that wrapper trips a (harmless, confirmed via live testing —
            no CSP violation, no broken interactivity) hydration-mismatch
            console warning under this app's nonce-based CSP, unfixable from
            here since it's Next's own generated markup. A plain tag has no
            such wrapper. No nonce prop either: it's an external, same-origin
            file, already authorized by the CSP's script-src 'self' alone. */}
        <script src="/theme-init.js" />
      </head>
      <body className="bg-white text-gray-900 dark:bg-[#0d1117] dark:text-[#e6edf3]">
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
