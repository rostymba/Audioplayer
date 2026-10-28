// Пайплайн рычага A: главы книги → локальные эмбеддинги → облачный интерпретатор → многомерный профиль.
// Фаза 3 (каркас): эмбеддер и интерпретатор пока стабы; наружу передаются только вектора, не текст.
// Когда подключим реальную модель (Next API-роут), меняются только getEmbedder/getInterpreter — контракт тот же.

import { getEmbedder } from './embeddings';
import { getInterpreter, type BookAtmosphere } from './atmosphere-profile';
import { meanVector } from './vector';
import type { AtmosphereProfile } from './types';

export async function analyzeBook(chapters: string[], hint: AtmosphereProfile): Promise<BookAtmosphere> {
  const embedder = getEmbedder();
  const chapterVectors = await embedder.embed(chapters.length ? chapters : ['']);
  const bookVector = meanVector(chapterVectors);
  return getInterpreter().interpret({ bookVector, chapterVectors, hint });
}
