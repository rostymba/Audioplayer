import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diversify, nextStation } from '../../lib/radio-selection.ts';
import type { RadioStation } from '../../lib/types.ts';

const station = (id: string, country: string, over: Partial<RadioStation> = {}): RadioStation => ({
  id, name: `Station ${id}`, url: `http://example.org/${id}`, homepage: '', favicon: '',
  tags: ['ambient'], country, language: '', codec: 'MP3', bitrate: 128, votes: 0, ...over,
});

test('склеивает кодек-варианты одной станции', () => {
  const mp3 = station('a', 'France', { name: 'SomaFM Groove Salad (128k MP3)' });
  const aac = station('b', 'France', { name: 'SomaFM Groove Salad (128k AAC)', url: 'https://example.org/aac' });
  const other = station('c', 'Japan');
  assert.equal(diversify([mp3, aac, other]).length, 2);
});

test('одинаковый URL не дублируется', () => {
  const first = station('a', 'France');
  const same = station('b', 'Japan', { url: first.url });
  assert.equal(diversify([first, same]).length, 1);
});

test('чередует страны', () => {
  const list = [station('a1', 'France'), station('a2', 'France'), station('b1', 'Japan')];
  assert.deepEqual(diversify(list).map(entry => entry.country), ['France', 'Japan', 'France']);
});

test('следующая станция предпочитает другую страну', () => {
  const list = [station('a', 'France'), station('b', 'Japan'), station('c', 'Brazil')];
  assert.equal(nextStation(list, list[0], new Set(['a']))?.country, 'Japan');
  assert.equal(nextStation(list, list[1], new Set(['a', 'b']))?.country, 'Brazil');
});

test('посещённые и текущая исключаются', () => {
  const list = [station('a', 'France'), station('b', 'Japan')];
  assert.equal(nextStation(list, list[0], new Set(['a', 'b'])), undefined);
});
