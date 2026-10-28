import { NextRequest, NextResponse } from "next/server";
import { diversify } from '@/lib/radio-selection';
import { discoverSoma, discoverParadise } from '@/lib/radio-providers';
import type { RadioStation } from '@/lib/types';
import { appendDiag } from '@/lib/diag-log';

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
    source: 'Radio Browser' as const,
    name: station.name.trim() || "Untitled station",
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
  const results = await Promise.allSettled(
    (tags.length ? tags.slice(0, 8) : ['']).map(async (tag) => {
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
  if (results.every(result => result.status === 'rejected')) throw new Error('Radio Browser unavailable');
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

export async function GET(request: NextRequest) {
  appendDiag('catalog.request', { tags: request.nextUrl.searchParams.get('tags'), offset: request.nextUrl.searchParams.get('offset'),
    instance: request.nextUrl.searchParams.get('_i'), run: request.nextUrl.searchParams.get('_r'),
    ready: request.nextUrl.searchParams.get('_ready'), book: request.nextUrl.searchParams.get('_book') });
  const requestedTags = request.nextUrl.searchParams
    .get("tags")
    ?.split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean).slice(0, 8) ?? (request.nextUrl.searchParams.get('world') === '1' ? [] : ["ambient"]);

  const offsetValue = Number(request.nextUrl.searchParams.get('offset') || 0);
  const offset = Number.isFinite(offsetValue) ? Math.max(0, Math.floor(offsetValue)) : 0;
  const direct = Promise.allSettled(offset === 0
    ? [discoverSoma(requestedTags), discoverParadise(requestedTags)]
    : [Promise.resolve([] as RadioStation[]), Promise.resolve([] as RadioStation[])]);

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

  const directResults = await direct;
  const directStations = directResults.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const providers = [
    { source: 'Radio Browser', status: lastError && !rawStations.length ? 'unavailable' : 'ok', count: rawStations.length },
    ...directResults.map((r, index) => ({ source: ['SomaFM', 'Radio Paradise'][index],
      status: offset > 0 ? 'first-page-only' : r.status === 'fulfilled' ? 'ok' : 'unavailable',
      count: r.status === 'fulfilled' ? r.value.length : 0 })),
  ];
  if (!rawStations.length && !directStations.length && lastError) {
    return NextResponse.json(
      { stations: [], providers, error: "Could not fetch matching stations from the available sources" },
      { status: 502 },
    );
  }

  const seen = new Set<string>();
  const browserStations = rawStations
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
    });
  // Prefer a network's direct entry when Radio Browser also lists the same station.
  const stations = diversify([...directStations, ...browserStations]);

  return NextResponse.json({ stations, providers, tags: requestedTags, hasMore: rawStations.length >= 250, nextOffset: offset + 250, countries: new Set(stations.map(s => s.country).filter(Boolean)).size, source: 'Radio Browser + SomaFM + Radio Paradise' });
}
