export type AtmosphereKey = "dark" | "fantasy" | "cozy" | "cosmic" | "mystery" | "classic" | "neutral";

export type AtmosphereProfile = {
  key: AtmosphereKey;
  label: string;
  tags: string[];
  confidence: number;
  note: string;
  colors: [string, string, string];
};

export type Highlight = {
  id: string;
  cfiRange: string; // диапазон epub.js: по нему подсветка восстанавливается при следующем открытии
  text: string;
  createdAt: number;
};

export type InkPoint = {
  x: number; // 0..1 относительно видимой области страницы
  y: number; // 0..1 относительно видимой области страницы
  pressure?: number;
};

export type InkStroke = {
  id: string;
  points: InkPoint[];
  color: string;
  width: number;
  createdAt: number;
};

export type InkNote = {
  id: string;
  anchorCfi: string; // позиция epub.js, рядом с которой была оставлена рукописная пометка
  progressPercent: number;
  columns: 1 | 2;
  strokes: InkStroke[];
  createdAt: number;
  updatedAt: number;
};

export type StoredBook = {
  id: string;
  title: string;
  author: string;
  language?: string;
  coverDataUrl?: string;
  file: Blob;
  fileName: string;
  createdAt: number;
  lastOpenedAt: number;
  progress?: string;
  progressPercent: number;
  status: "ready" | "processing" | "failed";
  atmosphere: AtmosphereProfile;
  sample?: string; // короткий текстовый образец книги для локального семантического тегирования
  highlights?: Highlight[]; // сохранённые выделения читателя
  inkNotes?: InkNote[]; // рукописные пометки на полях, привязанные к месту в книге
  locations?: string; // кэш карты позиций epub.js: без неё прогресс считается с нуля при каждом входе
};

export type RadioStation = {
  playbackUrl?: string;
  source?: 'Radio Browser' | 'SomaFM' | 'Radio Paradise';
  id: string;
  name: string;
  url: string;
  homepage: string;
  favicon: string;
  tags: string[];
  country: string;
  language: string;
  codec: string;
  bitrate: number;
  votes: number;
};

export type HistoryEntry = {
  stationId?: string;
  country?: string;
  streamUrl?: string;
  id: string;
  type: "station" | "transition" | "system" | "rejected" | "track";
  stationName: string;
  streamTitle?: string;
  timestamp: number;
  detail: string;
};
