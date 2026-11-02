import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy · side-by-side" };

// What the deployed site keeps about a visitor (lib/access.ts), for the footer link and Google's consent screen.
export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
      <h1 className="font-display text-4xl font-semibold tracking-tight">Privacy</h1>
      <div className="mt-6 max-w-xl space-y-4 text-muted [&_h2]:pt-4 [&_h2]:font-semibold [&_h2]:text-ink">
        <p>Browsing featured and saved comparisons needs no account, and nothing is stored about you.</p>
        <h2>Signing in</h2>
        <p>
          Signing in with Google gives this site your Google email address, name and profile picture. Only the email is
          used: to count your comparisons against the daily limit. A signed cookie in your browser keeps you signed in.
        </p>
        <h2>Each new comparison</h2>
        <p>
          A log entry records your email, IP address, the companies and lens compared, and the request&apos;s cost. It is
          deleted after 14 days. A per-day count of your comparisons is deleted after 2 days.
        </p>
        <p>
          The comparison itself is saved without any of your details, so anyone can open it later. Claude (Anthropic) is
          sent the companies&apos; SEC data, never your details.
        </p>
        <h2>In your browser</h2>
        <p>Your theme choice and whether the side panel is collapsed stay in your browser&apos;s storage.</p>
        <h2>Questions</h2>
        <p>
          Open an issue on{" "}
          <a href="https://github.com/pcampb33/side-by-side/issues" className="text-accent hover:underline">
            GitHub
          </a>
          .
        </p>
      </div>
    </main>
  );
}
