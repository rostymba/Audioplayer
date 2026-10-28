// Ранжирование станций (рычаг B). МГНОВЕННОЕ: по пересечению тегов, без модели.
// Книга уже переведена в теги Radio Browser (словарь тегов), станции тоже в них — так что
// прямое пересечение и точнее, и не грузит эмбеддер сотнями инференсов при загрузке радио.

import type { RadioStation } from './types';
import type { StationSignal } from './learning-store';

// Эвристика доступности из полей каталога (0..1).
export function availabilityScore(station: RadioStation): number {
  const https = station.url.startsWith('https://') ? 0.5 : 0;
  const bitrate = (Math.min(station.bitrate, 320) / 320) * 0.3;
  const votes = (Math.min(station.votes, 5000) / 5000) * 0.2;
  return https + bitrate + votes;
}

// Штраф по общему полю: чем больше отказов/рекламы, тем ниже (0..1, 1 = чисто).
export function signalPenalty(signal: StationSignal | undefined): number {
  if (!signal) return 1;
  // Не подключившийся поток бесполезен независимо от вкуса — вес выше отказов.
  const bad = signal.rejects * 1.5 + signal.adHits + signal.talkHits + signal.connectFails * 2;
  const good = signal.playedOk;
  return 1 / (1 + Math.max(0, bad - good) * 0.35);
}

export interface RankedStation {
  station: RadioStation;
  score: number;
  atmosphereMatch: number;
}

export interface RankOptions {
  atmosphereWeight?: number;
  availabilityWeight?: number;
}

// queryTags — теги книги в пространстве Radio Browser (из словаря тегов).
export function rankStations(
  stations: RadioStation[],
  queryTags: string[],
  signals: Map<string, StationSignal> = new Map(),
  options: RankOptions = {},
): RankedStation[] {
  const atmosphereWeight = options.atmosphereWeight ?? 0.85;
  const availabilityWeight = options.availabilityWeight ?? 0.15;
  const wanted = new Set(queryTags.map((tag) => tag.toLowerCase()).filter(Boolean));
  // Specific profile tags matter more than ubiquitous background-music tags.
  const broad = new Set(['ambient', 'instrumental', 'relaxation', 'electronic']);
  const weights = new Map([...wanted].map((tag, index) => [tag, (broad.has(tag) ? 0.45 : 1) / (1 + index * 0.12)]));
  const denom = [...weights.values()].reduce((sum, weight) => sum + weight, 0) || 1;

  return stations
    .map((station) => {
      const overlap = [...new Set(station.tags.map(tag => tag.toLowerCase()))].reduce((sum, tag) => sum + (weights.get(tag) ?? 0), 0);
      const atmosphereMatch = wanted.size ? Math.min(1, overlap / denom) : 0;
      const base = atmosphereWeight * atmosphereMatch + availabilityWeight * availabilityScore(station);
      const score = base * signalPenalty(signals.get(station.id));
      return { station, score, atmosphereMatch };
    })
    .sort((a, b) => b.score - a.score);
}
