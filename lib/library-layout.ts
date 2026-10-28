// Раскладка библиотечной сетки. Ширина ячейки — это глубина прочтения книги,
// но ряд обязан заполняться целиком: остаток колонок раздаётся карточкам ряда,
// иначе в сетке почти всегда зияет пустая ячейка.

export const LIBRARY_COLUMNS = 12;

/** Базовая ширина по ступеням прогресса: 0% — самая маленькая ячейка. */
const TIER_WIDTHS = [4, 6, 8, 12];
/** Минимальная ширина карточки и максимум карточек в ряду. */
const MIN_SPAN = 3;
const MAX_PER_ROW = 4;
/** Суммарная базовая ширина, после которой троица в ряд уже не помещается по смыслу. */
const WIDE_ROW_LIMIT = 16;

export type LibraryCell = {
  /** Сколько колонок занимает карточка после раздачи остатка. */
  span: number;
  /** Ступень прочтения: 0..3. Управляет высотой ячейки и размером обложки. */
  tier: number;
  /** Карточка закрывает ряд — у неё не нужен правый бордер. */
  endsRow: boolean;
};

export function depthTier(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  if (percent >= 75) return 3;
  if (percent >= 45) return 2;
  if (percent >= 15) return 1;
  return 0;
}

export function layoutLibrary(percents: number[]): LibraryCell[] {
  const tiers = percents.map(depthTier);
  const base = tiers.map((tier) => TIER_WIDTHS[tier]);
  const cells: LibraryCell[] = tiers.map((tier) => ({ span: 0, tier, endsRow: false }));

  let start = 0;
  while (start < base.length) {
    const size = rowSize(base, start);
    const row: number[] = [];
    for (let i = start; i < start + size; i += 1) row.push(i);
    distribute(cells, row, base);
    cells[row[row.length - 1]].endsRow = true;
    start += size;
  }

  return cells;
}

/**
 * Сколько карточек ставим в ряд. Одна карточка на всю ширину — только если книга
 * в библиотеке единственная: иначе такие ряды идут подряд и сетка превращается
 * в стопку полос. Мелкие карточки пускаем по три, крупные — по две.
 */
function rowSize(base: number[], start: number): number {
  const left = base.length - start;
  if (left <= 2) return left;

  const nextThree = base[start] + base[start + 1] + base[start + 2];
  let size = nextThree <= WIDE_ROW_LIMIT ? 3 : 2;
  // Не оставляем одинокий хвост: он растянулся бы во всю ширину.
  if (left - size === 1) size = size >= 3 ? size - 1 : left;
  return Math.min(size, MAX_PER_ROW);
}

/** Раздаём 12 колонок пропорционально базовой ширине, но не уже минимума. */
function distribute(cells: LibraryCell[], row: number[], base: number[]) {
  for (const index of row) cells[index].span = MIN_SPAN;
  const left = LIBRARY_COLUMNS - MIN_SPAN * row.length;
  if (left <= 0) return;

  const total = row.reduce((sum, index) => sum + base[index], 0);
  let handed = 0;
  for (const index of row) {
    const share = Math.floor((left * base[index]) / total);
    cells[index].span += share;
    handed += share;
  }
  // Остаток от округления — самым прочитанным карточкам ряда.
  const priority = [...row].sort((a, b) => base[b] - base[a] || a - b);
  let cursor = 0;
  while (handed < left) {
    cells[priority[cursor % priority.length]].span += 1;
    cursor += 1;
    handed += 1;
  }
}
