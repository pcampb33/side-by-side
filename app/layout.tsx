import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { THEME_SCRIPT } from "@/lib/theme";
import { Account } from "./account";
import "./globals.css";
import { ThemeSwitch } from "./theme-switch";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });

const description = "Compare two US public companies, grounded in their SEC filings.";
export const metadata: Metadata = {
  title: "side-by-side",
  description,
  openGraph: { title: "side-by-side", description },
  twitter: { card: "summary_large_image" },
};

// Sign-in, limits and logging exist only on the deployed site (SPEC §5).
const signInOn = process.env.REQUIRE_SIGN_IN === "true";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col font-sans antialiased">
        <header className="border-b border-rule">
          <div className="site-width mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="font-display text-lg font-semibold tracking-tight">
              side-by-side
            </Link>
            <div className="flex items-center gap-5">
              {signInOn && (
                <Suspense>
                  <Account />
                </Suspense>
              )}
              <ThemeSwitch />
            </div>
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="border-t border-rule text-sm text-muted">
          <div className="site-width mx-auto max-w-5xl space-y-2 px-4 py-6 sm:px-6">
            <p>Data from SEC EDGAR filings. Not financial advice.</p>
            {signInOn && (
              <p>
                Privacy: signing in gives this site your Google email. Each new comparison is logged with your email, IP address, the
                companies compared and its cost, kept 14 days to enforce the limits. Nothing else is stored about you.{" "}
                <Link href="/privacy" className="text-accent hover:underline">
                  Privacy details
                </Link>
                {" · "}
                <Link href="/terms" className="text-accent hover:underline">
                  Terms
                </Link>
              </p>
            )}
          </div>
        </footer>
      </body>
    </html>
  );
}
