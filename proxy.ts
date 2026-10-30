import { NextResponse, type NextRequest } from "next/server";
import { canonicalComparePath } from "./lib/compare-url";

// MSFT-vs-aapl → AAPL-vs-MSFT: one URL, and one cache entry, per pair.
export function proxy(request: NextRequest) {
  const canonical = canonicalComparePath(request.nextUrl.pathname);
  if (!canonical || canonical === request.nextUrl.pathname) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = canonical;
  return NextResponse.redirect(url, 308);
}

export const config = { matcher: "/compare/:pair/:lens" };
