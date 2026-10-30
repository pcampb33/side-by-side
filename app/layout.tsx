import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "company-compare",
  description: "Compare two US public companies, grounded in their SEC filings.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
