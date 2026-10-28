// Общая векторная математика для эмбеддинг-подбора (рычаги A и B).

export type Vector = number[];

export function cosineSimilarity(a: Vector, b: Vector): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function meanVector(vectors: Vector[]): Vector {
  if (!vectors.length) return [];
  const dimensions = vectors[0].length;
  const result = new Array<number>(dimensions).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < dimensions; i += 1) result[i] += vector[i] ?? 0;
  }
  for (let i = 0; i < dimensions; i += 1) result[i] /= vectors.length;
  return result;
}
