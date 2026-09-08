import type { RadioStation } from './types';

export function stationKey(station: RadioStation) {
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
