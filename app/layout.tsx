import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

// Self-hosted at build time by next/font, so no request ever leaves the page
// for a font file — which is also what keeps them inside the CSP's
// `font-src 'self'` (middleware.ts) without widening it to Google's origins.
const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  // A page that sets its own title reads "Account · Notecom"; the vault and
  // anything that doesn't gets the plain default.
  title: { default: "Notecom", template: "%s · Notecom" },
  description: "Lesson notes generated from your slides, rewritten in plain language.",
  applicationName: "Notecom",
  // The vault is per-account and behind a sign-in gate; there is nothing here
  // worth indexing and quite a lot worth not indexing.
  robots: { index: false, follow: false },
  openGraph: {
    title: "Notecom",
    description: "Lesson notes generated from your slides, rewritten in plain language.",
    siteName: "Notecom",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Load-bearing, despite nothing below reading the return value: Next.js
  // only auto-applies middleware.ts's per-request CSP nonce to its OWN
  // inline hydration/RSC-streaming scripts when a Server Component in the
  // render tree calls headers() — omit this and every one of those scripts
  // ships with no nonce and a strict script-src blocks all of them outright.
  // Removed once already (mistaking dev-mode Turbopack's silence for proof
  // it was unnecessary) and that broke production: real `next build` output
  // serves several separate inline scripts, none of which the dev server's
  // hot-reload path happened to exercise the same way. Don't remove this
  // again without testing against an actual production build.
  await headers();

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
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
      <body className="bg-white font-sans text-gray-900 antialiased dark:bg-[#0d1117] dark:text-[#e6edf3]">
        {/* First thing in the tab order, visible only once focused: a keyboard
            reader shouldn't have to walk the whole sidebar tree to reach the
            document. Every page that has a main region marks it `#main`. */}
        <a href="#main" className="ui-skip-link">
          Skip to content
        </a>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
