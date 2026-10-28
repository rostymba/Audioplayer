import { resolveParadiseStream, resolveSomaStream } from './radio-providers';

const RADIO_BROWSER_HOSTS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];

function safeStream(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}

export async function resolveStationStream(stationId: string) {
  if (/^soma:[a-z0-9]{1,32}$/.test(stationId)) return safeStream(await resolveSomaStream(stationId));
  if (/^rp:[0-3]$/.test(stationId)) return safeStream(resolveParadiseStream(stationId));
  if (!/^[a-f0-9-]{8,64}$/.test(stationId)) return null;
  for (const host of RADIO_BROWSER_HOSTS) {
    try {
      const response = await fetch(new URL(`/json/stations/byuuid/${encodeURIComponent(stationId)}`, host), {
        headers: { 'User-Agent': 'Audioplayer/0.1 (personal reading demo)' },
        signal: AbortSignal.timeout(4000), next: { revalidate: 1800 },
      });
      if (!response.ok) continue;
      const stations = await response.json() as Array<{ url_resolved?: string }>;
      const stream = safeStream(stations[0]?.url_resolved);
      if (stream) return stream;
    } catch { /* Try the next mirror. */ }
  }
  return null;
}
