import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";
import { ThemeSwitch } from "./theme-switch";

const sans = Inter({ subsets: ["latin"], variable: "--font-inter" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif" });

export const metadata: Metadata = {
  title: "company-compare",
  description: "Compare two US public companies, grounded in their SEC filings.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col font-sans antialiased">
        <header className="border-b border-rule">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="font-serif text-lg font-semibold tracking-tight">
              company-compare
            </Link>
            <ThemeSwitch />
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="border-t border-rule text-sm text-muted">
          <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">Data from SEC EDGAR filings. Not financial advice.</div>
        </footer>
      </body>
    </html>
  );
}
