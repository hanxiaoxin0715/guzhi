import { NextResponse } from "next/server";

/**
 * Proxy endpoint for fetching remote images.
 * Avoids CORS-tainted canvas issues when cropping remote images client-side.
 * Returns the image binary with proper Content-Type.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url || !url.startsWith("http")) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!resp.ok) {
      return NextResponse.json(
        { error: `Upstream ${resp.status}` },
        { status: resp.status }
      );
    }

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    // Validate content type to prevent SSRF abuse
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "URL does not point to an image" }, { status: 400 });
    }
    const buffer = await resp.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image proxy failed" }, { status: 502 });
  }
}
