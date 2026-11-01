import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";

// The 1200×630 link-preview card (opengraph-image.tsx here and in each
// comparison), in the site's light theme and font.
export const OG_SIZE = { width: 1200, height: 630 };

const regular = readFile(join(process.cwd(), "assets/PlusJakartaSans-Regular.ttf"));
const bold = readFile(join(process.cwd(), "assets/PlusJakartaSans-Bold.ttf"));

export const C = { paper: "#f2f3f8", surface: "#ffffff", ink: "#191c28", muted: "#646a80", rule: "#e3e6ee", a: "#5b5bd6", b: "#0e9585" };

export async function ogCard({ main, side }: { main: ReactNode; side: ReactNode }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", padding: 40, background: C.paper, fontFamily: "Jakarta", color: C.ink }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "44px 52px 36px", background: C.surface, borderRadius: 28, border: `1px solid ${C.rule}` }}>
          <div style={{ flex: 1, display: "flex", gap: 40 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>
                <Mark size={36} />
                side-by-side
              </div>
              {main}
            </div>
            <div style={{ width: 400, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ alignSelf: "flex-end", fontSize: 22, color: C.muted, marginBottom: 6 }}>From SEC filings</div>
              {side}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 21, color: C.muted, marginTop: 20 }}>
            <span>Built by Claude from each company&apos;s 10-K</span>
            <span>Every number cited</span>
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Jakarta", data: await regular, weight: 400, style: "normal" },
        { name: "Jakarta", data: await bold, weight: 700, style: "normal" },
      ],
    },
  );
}

// The overlap mark, as in app/icon.svg.
export function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <circle cx="11.5" cy="16" r="9" fill="none" stroke={C.a} strokeWidth="3.5" />
      <circle cx="20.5" cy="16" r="9" fill="none" stroke={C.b} strokeWidth="3.5" />
    </svg>
  );
}

// A paper box on the right: a label over its rows.
export function Box({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "18px 22px", background: C.paper, borderRadius: 18 }}>
      <div style={{ fontSize: 21, color: C.muted }}>{label}</div>
      {children}
    </div>
  );
}
