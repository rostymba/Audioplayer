import { NextRequest, NextResponse } from "next/server";

const RADIO_BROWSER_HOSTS = [
  "https://de1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
];

async function resolveStationStream(stationId: string) {
  for (const host of RADIO_BROWSER_HOSTS) {
    try {
      const lookupUrl = new URL(`/json/stations/byuuid/${encodeURIComponent(stationId)}`, host);
      const response = await fetch(lookupUrl, {
        headers: { "User-Agent": "Audioplayer/0.1 (personal reading demo)" },
        signal: AbortSignal.timeout(4000),
        next: { revalidate: 1800 },
      });
      if (!response.ok) continue;
      const stations = (await response.json()) as Array<{ url_resolved?: string }>;
      const candidate = stations[0]?.url_resolved;
      if (!candidate) continue;
      const streamUrl = new URL(candidate);
      if (streamUrl.protocol === "http:" || streamUrl.protocol === "https:") return streamUrl;
    } catch {
      // Try the next Radio Browser mirror.
    }
  }
  return null;
}

function parseMetadata(bytes: Uint8Array) {
  const value = new TextDecoder("utf-8").decode(bytes).replace(/\0+$/g, "");
  const match = value.match(/StreamTitle='([^']*)'/i);
  return match?.[1]?.trim() || null;
}

export async function GET(request: NextRequest) {
  const stationId = request.nextUrl.searchParams.get("stationId")?.trim().toLowerCase();
  if (!stationId || !/^[a-f0-9-]{8,64}$/.test(stationId)) {
    return NextResponse.json({ streamTitle: null }, { status: 400 });
  }

  const streamUrl = await resolveStationStream(stationId);
  if (!streamUrl) return NextResponse.json({ streamTitle: null }, { status: 404 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5500);
  try {
    const response = await fetch(streamUrl, {
      headers: {
        "Icy-MetaData": "1",
        "User-Agent": "Audioplayer/0.1 (personal reading demo)",
      },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    const interval = Number(response.headers.get("icy-metaint"));
    if (!response.ok || !response.body || !Number.isFinite(interval) || interval <= 0 || interval > 1_000_000) {
      return NextResponse.json({ streamTitle: null });
    }

    const reader = response.body.getReader();
    let buffer = new Uint8Array(0);
    while (buffer.length < interval + 4097) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const next = new Uint8Array(buffer.length + value.length);
      next.set(buffer);
      next.set(value, buffer.length);
      buffer = next;
      if (buffer.length > interval) {
        const length = buffer[interval] * 16;
        if (length === 0) return NextResponse.json({ streamTitle: null });
        if (buffer.length >= interval + 1 + length) {
          return NextResponse.json({ streamTitle: parseMetadata(buffer.slice(interval + 1, interval + 1 + length)) });
        }
      }
    }
    return NextResponse.json({ streamTitle: null });
  } catch {
    return NextResponse.json({ streamTitle: null });
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
