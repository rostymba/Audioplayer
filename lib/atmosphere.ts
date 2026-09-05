import type { AtmosphereProfile } from "./types";

const profiles: Array<AtmosphereProfile & { words: string[] }> = [
  {
    key: "dark",
    label: "Тёмная интенсивность",
    tags: ["dark ambient", "ambient", "cinematic"],
    confidence: 0,
    note: "Глубокий, медленный эфир без лишнего света.",
    colors: ["#ff7458", "#8f6bdc", "#251f29"],
    words: ["dark", "night", "death", "blood", "war", "fear", "тьм", "ноч", "смерт", "кров", "войн", "страх"],
  },
  {
    key: "fantasy",
    label: "Мифический простор",
    tags: ["fantasy", "soundtrack", "ambient"],
    confidence: 0,
    note: "Кинематографичный эфир для далёких миров.",
    colors: ["#68a7f4", "#9c7ce8", "#f2c95c"],
    words: ["magic", "dragon", "kingdom", "sword", "wizard", "маг", "дракон", "королев", "меч", "волшеб"],
  },
  {
    key: "cozy",
    label: "Тихое тепло",
    tags: ["chillout", "jazz", "lounge"],
    confidence: 0,
    note: "Мягкий эфир для спокойного, камерного чтения.",
    colors: ["#f2c95c", "#ff9b74", "#72a97e"],
    words: ["home", "tea", "coffee", "garden", "love", "дом", "чай", "кофе", "сад", "любов"],
  },
  {
    key: "cosmic",
    label: "Космический сигнал",
    tags: ["space", "electronic", "ambient"],
    confidence: 0,
    note: "Холодная электроника и ощущение дальнего сигнала.",
    colors: ["#285fe8", "#68a7f4", "#ff8e9e"],
    words: ["space", "planet", "star", "ship", "future", "космос", "планет", "звезд", "кораб", "будущ"],
  },
  {
    key: "mystery",
    label: "Скрытое напряжение",
    tags: ["mystery", "instrumental", "classical"],
    confidence: 0,
    note: "Сдержанный фон с едва заметным напряжением.",
    colors: ["#72a97e", "#68a7f4", "#4b4238"],
    words: ["murder", "detective", "secret", "clue", "crime", "убий", "детектив", "тайн", "улика", "преступ"],
  },
  {
    key: "classic",
    label: "Печатная классика",
    tags: ["classical", "piano", "instrumental"],
    confidence: 0,
    note: "Размеренное классическое радио без вокала.",
    colors: ["#c6aa67", "#e8e2d7", "#716d65"],
    words: ["chapter", "letter", "society", "century", "глава", "письмо", "общество", "век", "господин"],
  },
];

export const neutralAtmosphere: AtmosphereProfile = {
  key: "neutral",
  label: "Спокойный фон",
  tags: ["ambient", "instrumental", "relaxation"],
  confidence: 0.42,
  note: "Нейтральный эфир, который не спорит с текстом.",
  colors: ["#68a7f4", "#72a97e", "#f2c95c"],
};

export function analyzeAtmosphere(text: string, title: string): AtmosphereProfile {
  const source = `${title} ${text}`.toLowerCase();
  const scored = profiles
    .map((profile) => ({ profile, score: profile.words.reduce((sum, word) => sum + (source.split(word).length - 1), 0) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 2) return neutralAtmosphere;
  const confidence = Math.min(0.92, 0.5 + best.score / Math.max(20, source.length / 2400));
  const { words: _words, ...profile } = best.profile;
  void _words;
  return { ...profile, confidence };
}
