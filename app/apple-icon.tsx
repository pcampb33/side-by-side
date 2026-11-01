import { ImageResponse } from "next/og";

// The home-screen icon: the overlap mark (icon.svg) on a white tile.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
        <svg width="124" height="124" viewBox="0 0 32 32">
          <circle cx="11.5" cy="16" r="9" fill="none" stroke="#5b5bd6" strokeWidth="3.5" />
          <circle cx="20.5" cy="16" r="9" fill="none" stroke="#0e9585" strokeWidth="3.5" />
        </svg>
      </div>
    ),
    size,
  );
}
