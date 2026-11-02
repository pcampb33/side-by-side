import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms · side-by-side" };

// Plain terms for a free demo site, for the footer link and Google's consent screen.
export default function Terms() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
      <h1 className="font-display text-4xl font-semibold tracking-tight">Terms</h1>
      <div className="mt-6 max-w-xl space-y-4 text-muted [&_h2]:pt-4 [&_h2]:font-semibold [&_h2]:text-ink">
        <p>side-by-side is a free demo. Using it means accepting these terms.</p>
        <h2>Not financial advice</h2>
        <p>
          Comparisons are written by an AI model (Claude) from companies&apos; SEC filings. Every number links to its
          filing, but pages can still be wrong or incomplete. Check the filings before relying on anything here.
        </p>
        <h2>Fair use</h2>
        <p>
          Signed-in accounts get a few new comparisons a day, within a monthly budget. Don&apos;t try to get around the
          limits or overload the site. Accounts that do may be blocked.
        </p>
        <h2>No warranty</h2>
        <p>
          The site is provided as is, with no guarantee it is available, accurate or kept running. It may change or stop
          at any time. The code is open source under the{" "}
          <a href="https://github.com/pcampb33/side-by-side/blob/main/LICENSE" className="text-accent hover:underline">
            MIT license
          </a>
          .
        </p>
        <h2>Privacy</h2>
        <p>
          What the site keeps about you is on the{" "}
          <Link href="/privacy" className="text-accent hover:underline">
            privacy page
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
