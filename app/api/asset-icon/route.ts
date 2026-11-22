import { NextResponse } from "next/server";
import { resolveAssetIcon } from "@/lib/server/assetIcon";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = url.searchParams.get("k") ?? url.searchParams.get("symbol") ?? "";
  const icon = await resolveAssetIcon(input);
  if (!icon) {
    return NextResponse.json({ error: "Invalid asset icon parameter." }, { status: 400 });
  }
  return new NextResponse(new Uint8Array(icon.body), {
    status: 200,
    headers: {
      "Content-Type": icon.contentType,
      "Cache-Control": icon.authentic
        ? "public, max-age=604800, stale-while-revalidate=86400"
        : "public, max-age=600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox",
    },
  });
}
