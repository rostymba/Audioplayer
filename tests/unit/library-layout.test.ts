import test from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY_COLUMNS, depthTier, layoutLibrary } from '../../lib/library-layout.ts';

const rows = (cells: ReturnType<typeof layoutLibrary>) => {
  const out: number[][] = [];
  let current: number[] = [];
  for (const cell of cells) {
    current.push(cell.span);
    if (cell.endsRow) { out.push(current); current = []; }
  }
  if (current.length) out.push(current);
  return out;
};

test('ступени прогресса', () => {
  assert.equal(depthTier(0), 0);
  assert.equal(depthTier(14), 0);
  assert.equal(depthTier(15), 1);
  assert.equal(depthTier(44), 1);
  assert.equal(depthTier(45), 2);
  assert.equal(depthTier(75), 3);
  assert.equal(depthTier(100), 3);
});

test('каждый ряд заполнен целиком — пустых ячеек не остаётся', () => {
  for (const sample of [[0], [0, 0], [0, 0, 0], [0, 50], [90, 0, 0], [10, 20, 30, 40, 50, 60, 70]]) {
    for (const row of rows(layoutLibrary(sample))) {
      assert.equal(row.reduce((a, b) => a + b, 0), LIBRARY_COLUMNS, `ряд ${row} не закрыт`);
    }
  }
});

test('одинокая непрочитанная книга занимает всю ширину', () => {
  assert.deepEqual(layoutLibrary([0]).map((c) => c.span), [LIBRARY_COLUMNS]);
});

test('три непрочитанные книги делят ряд поровну', () => {
  assert.deepEqual(layoutLibrary([0, 0, 0]).map((c) => c.span), [4, 4, 4]);
});

test('внутри ряда прочитанная книга не уже непрочитанной', () => {
  const cells = layoutLibrary([0, 50]);
  assert.ok(cells[1].span >= cells[0].span, `${cells[1].span} должно быть не меньше ${cells[0].span}`);
});

test('закрывающая карточка помечена ровно в конце каждого ряда', () => {
  const cells = layoutLibrary([0, 0, 0, 0]);
  assert.deepEqual(cells.map((c) => c.endsRow), [false, true, false, true]);
});

test('пустая библиотека не роняет раскладку', () => {
  assert.deepEqual(layoutLibrary([]), []);
});

test('полосы во всю ширину не идут подряд', () => {
  for (const sample of [[100, 100], [100, 100, 100], [0, 100, 100], [80, 80, 10, 90]]) {
    const wide = layoutLibrary(sample).filter((cell) => cell.span === LIBRARY_COLUMNS);
    assert.equal(wide.length, 0, `в ${sample} нашлась полоса во всю ширину`);
  }
});

test('во всю ширину растягивается только единственная книга', () => {
  assert.deepEqual(layoutLibrary([100]).map((c) => c.span), [LIBRARY_COLUMNS]);
  assert.ok(layoutLibrary([100, 0]).every((c) => c.span < LIBRARY_COLUMNS));
});

test('одинокого хвоста в последнем ряду не остаётся', () => {
  for (const sample of [[0, 0, 0, 0], [0, 0, 0, 0, 0], [60, 60, 0, 0, 0]]) {
    const cells = layoutLibrary(sample);
    const lastRowStart = cells.findLastIndex((cell, i) => i < cells.length - 1 && cell.endsRow);
    const lastRow = cells.length - 1 - lastRowStart;
    assert.ok(lastRow >= 2, `хвост из ${lastRow} карточки в ${sample}`);
  }
});

test('внутри ряда ширина не меньше минимума', () => {
  for (const cell of layoutLibrary([0, 0, 100, 0, 0, 90])) assert.ok(cell.span >= 3);
});
