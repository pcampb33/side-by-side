import type { NextRequest } from "next/server";
import { getTickerIndex } from "@/lib/data";
import { searchTickers } from "@/lib/sec/search";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    return Response.json(searchTickers(await getTickerIndex(), q));
  } catch (err) {
    console.error("[search] ticker index unavailable:", err);
    return Response.json({ error: "The SEC company list is unavailable right now." }, { status: 502 });
  }
}
