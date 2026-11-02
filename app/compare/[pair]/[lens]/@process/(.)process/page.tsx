import { connection } from "next/server";
import { Suspense } from "react";
import { ProcessOverlay } from "../../process-views";

// Opened from the strip: the process over the comparison (SPEC §4a).
export default function ProcessOverlayPage() {
  return (
    <>
      <ProcessOverlay />
      {/* The [lens] metadata reads params; this marks the request-time render as intended. */}
      <Suspense>
        <RequestTime />
      </Suspense>
    </>
  );
}

async function RequestTime() {
  await connection();
  return null;
}
