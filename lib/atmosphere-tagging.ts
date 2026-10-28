// Матчер «текст книги → атмосферные теги» (ядро рычагов A и B).
// Эмбеддит текст и описания тегов ОДНИМ эмбеддером, косинусом берёт топ-теги,
// агрегирует их radioTags (для Radio Browser) и усредняет измерения.
// Со стаб-эмбеддером результат структурный; семантический лифт даёт локальная модель (EmbeddingGemma).

import { getEmbedder, type Embedder } from './embeddings';
import { cosineSimilarity, type Vector } from './vector';
import { ATMOSPHERE_TAGS, type AtmosphereTag } from './atmosphere-tags';
import type { AtmosphereDimensions } from './atmosphere-profile';

export interface ScoredTag { tag: AtmosphereTag; score: number; }
export interface TaggedAtmosphere {
  tags: ScoredTag[];
  radioTags: string[];
  dimensions: AtmosphereDimensions;
}

const NEUTRAL_DIMS: AtmosphereDimensions = {
  valence: 0.5, energy: 0.4, tension: 0.4, instrumental: 0.8, vocalTolerance: 0.4, era: 0.5,
};

let cachedVectors: Vector[] | null = null;
let cachedFor: Embedder | null = null;

async function tagVectors(embedder: Embedder): Promise<Vector[]> {
  if (cachedVectors && cachedFor === embedder) return cachedVectors;
  cachedVectors = await embedder.embed(ATMOSPHERE_TAGS.map((tag) => tag.description));
  cachedFor = embedder;
  return cachedVectors;
}

function aggregateDimensions(chosen: ScoredTag[]): AtmosphereDimensions {
  const keys = Object.keys(NEUTRAL_DIMS) as (keyof AtmosphereDimensions)[];
  const dims = { ...NEUTRAL_DIMS };
  for (const key of keys) {
    let sum = 0;
    let weight = 0;
    for (const { tag, score } of chosen) {
      const value = tag.dims?.[key];
      if (value === undefined) continue;
      const w = Math.max(0, score);
      sum += value * w;
      weight += w;
    }
    if (weight > 0) dims[key] = sum / weight;
  }
  return dims;
}

export async function matchTags(text: string, topK = 4): Promise<TaggedAtmosphere> {
  const embedder = getEmbedder();
  // Ограничиваем вход модели: токенайзер всё равно усекает, а короткий вход быстрее и стабильнее.
  const [textVector] = await embedder.embed([(text || '').slice(0, 4000)]);
  const vectors = await tagVectors(embedder);
  const scored = ATMOSPHERE_TAGS
    .map((tag, index) => ({ tag, score: cosineSimilarity(textVector, vectors[index]) }))
    .sort((a, b) => b.score - a.score);

  const positive = scored.filter((entry) => entry.score > 0);
  const source = positive.length ? positive : scored;
  // Several near-identical mood tags used to crowd out setting and sonic texture,
  // producing the same broad radio query for unrelated books.
  const groups = new Set<string>();
  const chosen: ScoredTag[] = [];
  for (const entry of source) {
    if (groups.has(entry.tag.group)) continue;
    groups.add(entry.tag.group);
    chosen.push(entry);
    if (chosen.length >= topK) break;
  }

  const radioTags: string[] = [];
  for (const { tag } of chosen) {
    for (const radioTag of tag.radioTags) {
      if (!radioTags.includes(radioTag)) radioTags.push(radioTag);
    }
  }

  return { tags: chosen, radioTags: radioTags.slice(0, 8), dimensions: aggregateDimensions(chosen) };
}

// Сброс кэша векторов тегов (например, после подмены эмбеддера на реальную модель).
export function resetTagVectorCache(): void {
  cachedVectors = null;
  cachedFor = null;
}
