"use client";

export default function CompareError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Couldn’t load these companies</h1>
      <p className="mt-3 max-w-xl text-muted">
        The SEC’s servers didn’t answer. Nothing was saved from the failed attempt, so trying again fetches fresh data.
      </p>
      <button type="button" onClick={retry} className="mt-6 rounded-full bg-accent px-5 py-2.5 font-medium text-accent-ink">
        Try again
      </button>
    </main>
  );
}
