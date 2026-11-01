import { LENSES } from "@/lib/lenses";
import { Box, C, ogCard, OG_SIZE } from "./og-card";

export const alt = "side-by-side: compare two US public companies from their SEC filings";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({
    main: (
      <div style={{ display: "flex", flexDirection: "column", marginTop: 40, fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: -2 }}>
        <span>Compare two US public companies,</span>
        <span style={{ color: C.muted }}>grounded in their SEC filings.</span>
      </div>
    ),
    side: (
      <Box label="Five lenses">
        {LENSES.map((l) => (
          <div key={l.slug} style={{ fontSize: 28, fontWeight: 700 }}>
            {l.label}
          </div>
        ))}
      </Box>
    ),
  });
}
