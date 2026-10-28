import type { RadioStation } from './types';

export type BookStationMemory = { assignments: Record<string, string>; recent: string[] };

export function stationKey(station: RadioStation) {
  try {
    const url = new URL(station.url);
    if (url.hostname.endsWith('.somafm.com')) {
      const channel = url.pathname.match(/^\/([a-z0-9]+)-\d+-(?:mp3|aac)/i)?.[1];
      if (channel) return `soma:${channel.toLowerCase()}`;
    }
    if (url.hostname === 'stream.radioparadise.com') {
      const channel = url.pathname.replace(/^\//, '').replace(/-(?:\d+|flac|aac|mp3).*$/, '');
      return `rp-stream:${['aac', 'mp3', 'flac'].includes(channel) ? 'main' : channel}`;
    }
  } catch { /* Legacy entries can lack a valid URL; use the name below. */ }
  return station.name.toLowerCase().replace(/\([^)]*(?:mp3|aac|ogg|\d+k)[^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').replace(/[^\p{L}\p{N}]/gu, '') + ':' + station.country;
}

export function diversify(stations: RadioStation[]) {
  const names = new Set<string>();
  const urls = new Set<string>();
  const countries = new Map<string, RadioStation[]>();
  for (const station of stations) {
    const key = stationKey(station);
    if (names.has(key) || urls.has(station.url)) continue;
    names.add(key); urls.add(station.url);
    const group = countries.get(station.country) ?? [];
    group.push(station); countries.set(station.country, group);
  }
  const result: RadioStation[] = [];
  while (countries.size) {
    for (const [country, group] of countries) {
      result.push(group.shift()!);
      if (!group.length) countries.delete(country);
    }
  }
  return result;
}

export function nextStation(stations: RadioStation[], current: RadioStation | null, visited: Set<string>) {
  const pool = stations.filter(s => s.id !== current?.id && s.url !== current?.url && !visited.has(s.id));
  return pool.find(s => s.country && s.country !== current?.country) ?? pool[0];
}

export function initialStationsForBook(stations: RadioStation[], bookId: string, memory: BookStationMemory) {
  const assignedId = memory.assignments[bookId];
  const assigned = assignedId ? stations.find(station => station.id === assignedId) : undefined;
  const recent = new Set(memory.recent);
  const fresh = stations.filter(station => !recent.has(station.id));
  const repeated = stations.filter(station => recent.has(station.id));
  return [...(assigned ? [assigned] : []), ...fresh.filter(station => station.id !== assignedId), ...repeated.filter(station => station.id !== assignedId)];
}

export function rememberBookStation(memory: BookStationMemory, bookId: string, stationId: string): BookStationMemory {
  return {
    assignments: { ...memory.assignments, [bookId]: stationId },
    recent: [stationId, ...memory.recent.filter(id => id !== stationId)].slice(0, 8),
  };
}
