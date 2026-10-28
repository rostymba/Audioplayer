// Многомерный профиль книги (рычаг A). Расширяет плоский AtmosphereProfile из types.ts.
// Фаза 0: интерфейс интерпретатора + мок-стаб, который выводит измерения из существующего
// эвристического профиля. Фаза 3: мок заменяется Next API-роутом (вектора -> профиль).

import type { AtmosphereKey, AtmosphereProfile } from './types';
import type { Vector } from './vector';

// Каждое измерение нормировано 0..1.
export interface AtmosphereDimensions {
  valence: number;        // мрачно (0) .. светло (1)
  energy: number;         // спокойно (0) .. интенсивно (1)
  tension: number;        // расслабленно (0) .. напряжённо (1)
  instrumental: number;   // тяга к инструменталу (1 = только инструментал)
  vocalTolerance: number; // терпимость к вокалу (0 = вокал нежелателен)
  era: number;            // старинное/акустическое (0) .. современное/электронное (1)
}

export interface RichAtmosphereProfile {
  key: AtmosphereKey;
  label: string;
  tags: string[];
  confidence: number;
  dimensions: AtmosphereDimensions;
}

export interface BookAtmosphere {
  book: RichAtmosphereProfile;                 // профиль книги целиком
  chapters: RichAtmosphereProfile[];           // профиль по главам (единица нарезки)
}

// Вход интерпретатора: только вектора (текст не передаётся). Наружу — многомерный профиль.
export interface AtmosphereInterpreter {
  interpret(input: {
    bookVector: Vector;
    chapterVectors: Vector[];
    hint?: AtmosphereProfile; // локальная эвристика как подсказка, опционально
  }): Promise<BookAtmosphere>;
}

const DIMENSION_PRESETS: Record<AtmosphereKey, AtmosphereDimensions> = {
  dark:    { valence: 0.15, energy: 0.55, tension: 0.8,  instrumental: 0.85, vocalTolerance: 0.2, era: 0.5 },
  fantasy: { valence: 0.6,  energy: 0.6,  tension: 0.5,  instrumental: 0.8,  vocalTolerance: 0.3, era: 0.4 },
  cozy:    { valence: 0.8,  energy: 0.3,  tension: 0.2,  instrumental: 0.6,  vocalTolerance: 0.6, era: 0.5 },
  cosmic:  { valence: 0.5,  energy: 0.45, tension: 0.5,  instrumental: 0.9,  vocalTolerance: 0.2, era: 0.9 },
  mystery: { valence: 0.35, energy: 0.4,  tension: 0.7,  instrumental: 0.85, vocalTolerance: 0.25, era: 0.5 },
  classic: { valence: 0.55, energy: 0.35, tension: 0.35, instrumental: 0.9,  vocalTolerance: 0.15, era: 0.2 },
  neutral: { valence: 0.5,  energy: 0.4,  tension: 0.4,  instrumental: 0.8,  vocalTolerance: 0.4, era: 0.5 },
};

function toRich(profile: AtmosphereProfile): RichAtmosphereProfile {
  return {
    key: profile.key,
    label: profile.label,
    tags: profile.tags,
    confidence: profile.confidence,
    dimensions: DIMENSION_PRESETS[profile.key],
  };
}

// Мост для рычага B: плоский профиль → многомерный (до появления реального интерпретатора).
export const richFromProfile = toRich;

// Мок: восстанавливает измерения из плоского профиля-подсказки. Векторы принимает, но
// в фазе 0 не использует семантически — контракт готов к реальной модели.
class StubInterpreter implements AtmosphereInterpreter {
  async interpret(input: { bookVector: Vector; chapterVectors: Vector[]; hint?: AtmosphereProfile }): Promise<BookAtmosphere> {
    const fallback: AtmosphereProfile = input.hint ?? {
      key: 'neutral', label: 'Calm backdrop', tags: ['ambient', 'instrumental', 'relaxation'],
      confidence: 0.42, note: '', colors: ['#68a7f4', '#72a97e', '#f2c95c'],
    };
    const rich = toRich(fallback);
    return {
      book: rich,
      chapters: input.chapterVectors.map(() => rich),
    };
  }
}

let interpreter: AtmosphereInterpreter = new StubInterpreter();

export function getInterpreter(): AtmosphereInterpreter {
  return interpreter;
}

export function setInterpreter(next: AtmosphereInterpreter): void {
  interpreter = next;
}
