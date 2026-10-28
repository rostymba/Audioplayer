// Локальная эмбеддинг-модель (рычаг A, шаг 1). Наружу уходят только вектора, не текст.
// Фаза 0: стаб с детерминированными псевдо-векторами, чтобы обвязка собиралась и тестировалась.
// Фаза 3: заменяется настоящей локальной моделью с тем же контрактом.

import type { Vector } from './vector';

export interface Embedder {
  readonly dimensions: number;
  embed(texts: string[]): Promise<Vector[]>;
}

// Детерминированный хеш-эмбеддер: стабилен между запусками, без сети и без модели.
// НЕ семантический — только для проверки конвейера в фазе 0.
class StubEmbedder implements Embedder {
  readonly dimensions = 64;

  async embed(texts: string[]): Promise<Vector[]> {
    return texts.map((text) => {
      const vector = new Array<number>(this.dimensions).fill(0);
      for (const token of text.toLowerCase().split(/\s+/).filter(Boolean)) {
        let hash = 0;
        for (let i = 0; i < token.length; i += 1) hash = (hash * 31 + token.charCodeAt(i)) | 0;
        vector[Math.abs(hash) % this.dimensions] += 1;
      }
      return vector;
    });
  }
}

let embedder: Embedder = new StubEmbedder();
let usingRealEmbedder = false;

// true только когда активна настоящая модель (не StubEmbedder). Живой путь тегов гейтится этим.
export function isRealEmbedder(): boolean {
  return usingRealEmbedder;
}

// Включить реальную модель (см. инструкцию ниже): помечает эмбеддер как настоящий.
export function useRealEmbedder(next: Embedder): void {
  embedder = next;
  usingRealEmbedder = true;
}

export function getEmbedder(): Embedder {
  return embedder;
}

export function setEmbedder(next: Embedder): void {
  embedder = next;
}

// --- Реальная локальная модель в Web Worker (решение v2.1) ---
// Инференс тяжёлый и на главном потоке вешает вкладку, поэтому модель живёт в Web Worker.

function createWorkerEmbedder(): Embedder {
  const worker = new Worker(new URL('./embedder.worker.ts', import.meta.url), { type: 'module' });
  let seq = 0;
  const pending = new Map<number, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>();
  worker.onmessage = (event: MessageEvent) => {
    const { id, vectors, error } = event.data as { id: number; vectors?: number[][]; error?: string };
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error) entry.reject(new Error(error));
    else entry.resolve(vectors ?? []);
  };
  return {
    dimensions: 384,
    embed(texts: string[]) {
      const id = (seq += 1);
      return new Promise<number[][]>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, texts });
      });
    },
  };
}

let realLoadPromise: Promise<Embedder> | null = null;

// Лениво поднимает воркер с моделью (первый прогрев качает ~120 МБ, кэшируется браузером).
// Всё вне главного потока — UI не виснет. Реальной модель помечаем только при успешном прогреве;
// при сбое остаётся Stub (keyword-путь).
export function ensureRealEmbedder(): Promise<Embedder> | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  if (usingRealEmbedder) return Promise.resolve(embedder);
  if (!realLoadPromise) {
    const candidate = createWorkerEmbedder();
    realLoadPromise = candidate.embed(['warmup'])
      .then(() => { embedder = candidate; usingRealEmbedder = true; return candidate; })
      .catch((error) => { realLoadPromise = null; throw error; });
  }
  return realLoadPromise;
}
