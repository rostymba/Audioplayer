import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTags } from '../../lib/atmosphere-tagging.ts';

test('возвращает непустой набор тегов Radio Browser', async () => {
  const result = await matchTags('a quiet winter morning by the frozen river');
  assert.ok(result.radioTags.length > 0);
  assert.ok(result.tags.length > 0);
});

test('детерминирован: один текст — один результат', async () => {
  const text = 'dragons war blood throne betrayal';
  const first = await matchTags(text);
  const second = await matchTags(text);
  assert.deepEqual(first.radioTags, second.radioTags);
});

test('разные книги дают разные наборы станционных тегов', async () => {
  const cosy = await matchTags('home tea garden warm quiet evening love letters');
  const grim = await matchTags('war blood murder dread corpse terror nightmare');
  assert.notDeepEqual(cosy.radioTags, grim.radioTags);
});

test('измерения остаются в диапазоне 0..1', async () => {
  const result = await matchTags('space station distant stars cold signal');
  for (const [key, value] of Object.entries(result.dimensions)) {
    assert.ok(value >= 0 && value <= 1, `${key} вне диапазона: ${value}`);
  }
});

test('пустой текст не роняет матчер', async () => {
  const result = await matchTags('');
  assert.ok(Array.isArray(result.radioTags));
});
