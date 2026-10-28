// Классификатор строки ICY StreamTitle (рычаг C.1).
// Фаза 1: эвристики по строке. Позже усилится (тогда confidence станет настоящим числом-порогом).

export type TrackCategory = 'track' | 'ad' | 'talk' | 'jingle' | 'unknown';

export interface TrackClassification {
  category: TrackCategory;
  confidence: number; // 0..1; для 'unknown' ~0
}

const AD_MARKERS = [
  'реклама', 'advert', 'advertisement', 'commercial', 'sponsor', 'sponsored',
  'buy now', 'call now', 'order now', 'discount', 'sale', 'promo', 'скидк', 'акция',
  'www.', 'http://', 'https://', '.com', '.ru', '.net', 'звоните', 'phone',
];

const TALK_MARKERS = [
  'news', 'новости', 'talk', 'interview', 'интервью', 'weather', 'погода',
  'traffic', 'прогноз', 'headlines', 'briefing', 'обзор', 'подкаст', 'podcast', 'live show',
];

const JINGLE_MARKERS = [
  'jingle', 'station id', 'station', 'radio id', 'id -', 'заставка', 'позывные',
];

function includesAny(haystack: string, markers: string[]): boolean {
  return markers.some((m) => haystack.includes(m));
}

// Похоже на «Artist - Track»: разделитель с осмысленным текстом с обеих сторон.
function looksLikeArtistTrack(value: string): boolean {
  const parts = value.split(/\s+[-–—]\s+/);
  if (parts.length < 2) return false;
  return parts.slice(0, 2).every((part) => part.replace(/[^\p{L}\p{N}]/gu, '').length >= 2);
}

export function classifyStreamTitle(rawTitle: string | null | undefined, stationName = ''): TrackClassification {
  const title = (rawTitle ?? '').trim();
  if (!title) return { category: 'unknown', confidence: 0 };

  const lower = title.toLowerCase();
  const station = stationName.trim().toLowerCase();

  // Только имя станции в метаданных — трека нет.
  if (station && (lower === station || (station.length > 3 && lower.includes(station) && title.length <= stationName.length + 3))) {
    return { category: 'jingle', confidence: 0.5 };
  }

  if (includesAny(lower, AD_MARKERS)) return { category: 'ad', confidence: 0.85 };

  // Длинный телефонный номер — сильный признак рекламы.
  if ((title.match(/\d/g)?.length ?? 0) >= 7) return { category: 'ad', confidence: 0.75 };

  if (includesAny(lower, TALK_MARKERS)) return { category: 'talk', confidence: 0.7 };
  if (includesAny(lower, JINGLE_MARKERS)) return { category: 'jingle', confidence: 0.6 };

  if (looksLikeArtistTrack(title)) return { category: 'track', confidence: 0.8 };

  // Есть строка, но паттерн не распознан — не действуем.
  return { category: 'unknown', confidence: 0.2 };
}

// Нужно ли уводить эфир с этого сегмента (реклама/речь). Джингл и неизвестное — терпим.
export function isNonMusic(category: TrackCategory): boolean {
  return category === 'ad' || category === 'talk';
}

export function isLikelyRussianText(value: string | null | undefined): boolean {
  const text = value ?? '';
  const letters = text.match(/\p{L}/gu) ?? [];
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu) ?? [];
  return cyrillic.length >= 4 && cyrillic.length / Math.max(letters.length, 1) >= 0.55;
}
