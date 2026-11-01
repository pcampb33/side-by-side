"use client";

import Link from "next/link";
import { signInWithGoogle } from "@/app/auth-actions";
import { DAILY_LIMIT, type BlockReason } from "@/lib/access";

// Shown when this comparison would need a new generation that isn't allowed
// (lib/access.ts). Not an error: it says what's still open and how to run the
// app without limits.

const REPO = "https://github.com/pcampb33/side-by-side";

const TEXT: Record<BlockReason, string> = {
  "sign-in": "Claude hasn't built this comparison yet. Sign in with Google to have it built.",
  daily: `You've used today's ${DAILY_LIMIT} new comparisons. More open tomorrow.`,
  budget: "This month's budget for new comparisons on this site is used up.",
};

export function BlockedPanel({ reason }: { reason: BlockReason }) {
  return (
    <div className="featured-in card px-5 py-5">
      <p>{TEXT[reason]}</p>
      {reason === "sign-in" && (
        <form action={() => signInWithGoogle(window.location.pathname + window.location.search)} className="mt-4">
          <button type="submit" className="rounded-full bg-ink px-5 py-2.5 text-sm text-paper transition-opacity hover:opacity-85">
            Sign in with Google
          </button>
        </form>
      )}
      <p className="mt-4 text-sm text-muted">
        Saved comparisons and the{" "}
        <Link href="/" className="text-accent hover:underline">
          featured ones
        </Link>{" "}
        are always open, or{" "}
        <a href={REPO} className="text-accent hover:underline">
          clone the repo
        </a>{" "}
        to run it with your own key.
      </p>
    </div>
  );
}
