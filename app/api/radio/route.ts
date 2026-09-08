import { NextRequest, NextResponse } from "next/server";
import { diversify } from '@/lib/radio-selection';

const RADIO_BROWSER_HOSTS = [
  "https://de1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
];

type RadioBrowserStation = {
  stationuuid: string;
  name: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  language: string;
  codec: string;
  bitrate: number;
  votes: number;
  clickcount: number;
  lastcheckok: number;
  hls: number;
};

function normalizeStation(station: RadioBrowserStation) {
  return {
    id: station.stationuuid,
    name: station.name.trim() || "Без названия",
    url: station.url_resolved,
    homepage: station.homepage,
    favicon: station.favicon,
    tags: station.tags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
    country: station.country,
    language: station.language,
    codec: station.codec,
    bitrate: station.bitrate,
    votes: station.votes,
    score: station.votes * 2 + station.clickcount / 40 + Math.min(station.bitrate, 320) + (station.url_resolved.startsWith("https://") ? 500 : 0),
  };
}

async function queryHost(host: string, tags: string[], params: URLSearchParams) {
  const results = await Promise.all(
    (tags.length ? tags.slice(0, 3) : ['']).map(async (tag) => {
      const url = new URL("/json/stations/search", host);
      if (tag) url.searchParams.set("tag", tag);
      for (const key of ['name', 'countrycode', 'language']) {
        const value = params.get(key)?.slice(0, 100);
        if (value) url.searchParams.set(key, value);
      }
      const offset = Number(params.get('offset') || 0);
      url.searchParams.set('offset', String(Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0));
      url.searchParams.set("hidebroken", "true");
      url.searchParams.set("order", "clickcount");
      url.searchParams.set("reverse", "true");
      url.searchParams.set("limit", "250");
      const response = await fetch(url, {
        headers: { "User-Agent": "Audioplayer/0.1 (personal reading demo)" },
        signal: AbortSignal.timeout(6500),
        next: { revalidate: 1800 },
      });
      if (!response.ok) throw new Error(`Radio Browser returned ${response.status}`);
      return (await response.json()) as RadioBrowserStation[];
    }),
  );
  return results.flat();
}

export async function GET(request: NextRequest) {
  const requestedTags = request.nextUrl.searchParams
    .get("tags")
    ?.split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean) ?? (request.nextUrl.searchParams.get('world') === '1' ? [] : ["ambient"]);

  let rawStations: RadioBrowserStation[] = [];
  let lastError: unknown;
  for (const host of RADIO_BROWSER_HOSTS) {
    try {
      rawStations = await queryHost(host, requestedTags, request.nextUrl.searchParams);
      if (rawStations.length) break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!rawStations.length && lastError) {
    return NextResponse.json(
      { stations: [], error: lastError instanceof Error ? lastError.message : "Каталог радио временно недоступен" },
      { status: 502 },
    );
  }

  const seen = new Set<string>();
  const stations = diversify(rawStations
    .filter((station) => {
      if (!station.lastcheckok || !station.url_resolved || seen.has(station.stationuuid)) return false;
      const codec = station.codec.toUpperCase();
      if (!codec.includes("MP3") && !codec.includes("AAC") && !codec.includes("OGG")) return false;
      seen.add(station.stationuuid);
      return true;
    })
    .map(normalizeStation)
    .sort((a, b) => b.score - a.score)
    .map(({ score, ...station }) => {
      void score;
      return station;
    }));

  return NextResponse.json({ stations, tags: requestedTags, hasMore: rawStations.length >= 250, nextOffset: Number(request.nextUrl.searchParams.get('offset') || 0) + 250, countries: new Set(stations.map(s => s.country).filter(Boolean)).size, source: 'Radio Browser' });
}
