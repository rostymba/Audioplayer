export type AtmosphereKey = "dark" | "fantasy" | "cozy" | "cosmic" | "mystery" | "classic" | "neutral";

export type AtmosphereProfile = {
  key: AtmosphereKey;
  label: string;
  tags: string[];
  confidence: number;
  note: string;
  colors: [string, string, string];
};

export type StoredBook = {
  id: string;
  title: string;
  author: string;
  coverDataUrl?: string;
  file: Blob;
  fileName: string;
  createdAt: number;
  lastOpenedAt: number;
  progress?: string;
  progressPercent: number;
  status: "ready" | "processing" | "failed";
  atmosphere: AtmosphereProfile;
};

export type RadioStation = {
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
  id: string;
  type: "station" | "transition" | "system" | "rejected";
  stationName: string;
  streamTitle?: string;
  timestamp: number;
  detail: string;
};
