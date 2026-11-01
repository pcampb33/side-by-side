"use client";

import { useRef, useState } from "react";

// Phones open their own share sheet; elsewhere the link is copied and a toast
// confirms it. The link unfolds into its preview card (opengraph-image.tsx).
export function ShareButton() {
  const [on, setOn] = useState(false);
  const [said, setSaid] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const share = async () => {
    const url = location.href;
    if (matchMedia("(pointer: coarse)").matches && navigator.share) {
      // Closing the sheet without sharing rejects; nothing to say then.
      await navigator.share({ title: document.title, url }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(url);
    setSaid(true);
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 2000);
  };

  return (
    <>
      <button type="button" onClick={share} className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-surface px-3.5 py-1.5 text-sm transition ease-(--ease-spring) hover:border-muted active:scale-[0.96]">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden>
          <path d="M6.5 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2L7.6 4.2M9.5 6.5a3 3 0 0 0-4.2 0L3 8.8A3 3 0 0 0 7.2 13l1.2-1.2" />
        </svg>
        Share
      </button>
      <div role="status" data-on={on || undefined} className="toast fixed bottom-6 left-1/2 z-50 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-semibold whitespace-nowrap text-paper shadow-lg">
        {said && (
          <>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden>
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
            Link copied
          </>
        )}
      </div>
    </>
  );
}
