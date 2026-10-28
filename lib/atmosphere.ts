import type { AtmosphereProfile } from "./types";

const profiles: Array<AtmosphereProfile & { words: string[] }> = [
  {
    key: "dark",
    label: "Dark intensity",
    tags: ["dark ambient", "ambient", "cinematic"],
    confidence: 0,
    note: "Deep, slow air with no excess light.",
    colors: ["#ff7458", "#8f6bdc", "#251f29"],
    words: ["dark", "night", "death", "blood", "war", "fear", "тьм", "ноч", "смерт", "кров", "войн", "страх"],
  },
  {
    key: "fantasy",
    label: "Mythic expanse",
    tags: ["fantasy", "soundtrack", "ambient"],
    confidence: 0,
    note: "Cinematic air for far-off worlds.",
    colors: ["#68a7f4", "#9c7ce8", "#f2c95c"],
    words: ["magic", "dragon", "kingdom", "sword", "wizard", "маг", "дракон", "королев", "меч", "волшеб"],
  },
  {
    key: "cozy",
    label: "Quiet warmth",
    tags: ["chillout", "jazz", "lounge"],
    confidence: 0,
    note: "Soft air for calm, intimate reading.",
    colors: ["#f2c95c", "#ff9b74", "#72a97e"],
    words: ["home", "tea", "coffee", "garden", "love", "дом", "чай", "кофе", "сад", "любов"],
  },
  {
    key: "cosmic",
    label: "Cosmic signal",
    tags: ["space", "electronic", "ambient"],
    confidence: 0,
    note: "Cold electronics and the feel of a distant signal.",
    colors: ["#285fe8", "#68a7f4", "#ff8e9e"],
    words: ["space", "planet", "star", "ship", "future", "космос", "планет", "звезд", "кораб", "будущ"],
  },
  {
    key: "mystery",
    label: "Hidden tension",
    tags: ["mystery", "instrumental", "classical"],
    confidence: 0,
    note: "A restrained backdrop with a barely visible edge.",
    colors: ["#72a97e", "#68a7f4", "#4b4238"],
    words: ["murder", "detective", "secret", "clue", "crime", "убий", "детектив", "тайн", "улика", "преступ"],
  },
  {
    key: "classic",
    label: "Printed classics",
    tags: ["classical", "piano", "instrumental"],
    confidence: 0,
    note: "Measured classical radio, no vocals.",
    colors: ["#c6aa67", "#e8e2d7", "#716d65"],
    words: ["chapter", "letter", "society", "century", "глава", "письмо", "общество", "век", "господин"],
  },
];

export const neutralAtmosphere: AtmosphereProfile = {
  key: "neutral",
  label: "Calm backdrop",
  tags: ["ambient", "instrumental", "relaxation"],
  confidence: 0.42,
  note: "Neutral air that never argues with the text.",
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
