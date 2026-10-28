import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankStations, availabilityScore, signalPenalty } from '../../lib/station-match.ts';
import type { RadioStation } from '../../lib/types.ts';
import type { StationSignal } from '../../lib/learning-store.ts';

const station = (id: string, tags: string[], extra: Partial<RadioStation> = {}): RadioStation => ({
  id, name: `Station ${id}`, url: `http://example.org/${id}`, homepage: '', favicon: '',
  tags, country: 'France', language: '', codec: 'MP3', bitrate: 128, votes: 0, ...extra,
});

const signal = (stationId: string, over: Partial<StationSignal> = {}): StationSignal =>
  ({ stationId, rejects: 0, adHits: 0, talkHits: 0, playedOk: 0, connectFails: 0, ...over });

test('станция с совпадающими тегами ранжируется выше', () => {
  const stations = [station('miss', ['pop', 'talk']), station('hit', ['ambient', 'drone'])];
  const ranked = rankStations(stations, ['ambient', 'drone']);
  assert.equal(ranked[0].station.id, 'hit');
  assert.ok(ranked[0].atmosphereMatch > ranked[1].atmosphereMatch);
});

test('при равных скорах порядок входа сохраняется', () => {
  // Инвариант e2e: на одинаковых станциях первой должна остаться первая из каталога.
  const stations = [station('a', ['ambient']), station('b', ['ambient']), station('c', ['ambient'])];
  const ranked = rankStations(stations, ['ambient', 'instrumental', 'relaxation']);
  assert.deepEqual(ranked.map(entry => entry.station.id), ['a', 'b', 'c']);
});

test('отвергнутая станция опускается вниз', () => {
  const stations = [station('bad', ['ambient']), station('good', ['ambient'])];
  const signals = new Map([['bad', signal('bad', { rejects: 3 })]]);
  const ranked = rankStations(stations, ['ambient'], signals);
  assert.equal(ranked[0].station.id, 'good');
});

test('https и битрейт повышают доступность', () => {
  const plain = station('http', ['ambient']);
  const secure = station('https', ['ambient'], { url: 'https://example.org/s', bitrate: 320 });
  assert.ok(availabilityScore(secure) > availabilityScore(plain));
});

test('штраф по общему полю: чистая станция не штрафуется', () => {
  assert.equal(signalPenalty(undefined), 1);
  assert.ok(signalPenalty(signal('x', { rejects: 2 })) < 1);
  // Удачные проигрывания компенсируют старые отказы.
  assert.ok(signalPenalty(signal('x', { rejects: 2, playedOk: 5 })) === 1);
});

test('неподключающаяся станция уступает равной по тегам', () => {
  const stations = [station('dead', ['ambient', 'drone']), station('alive', ['ambient', 'drone'])];
  const signals = new Map([['dead', signal('dead', { connectFails: 2 })]]);
  const ranked = rankStations(stations, ['ambient', 'drone'], signals);
  assert.equal(ranked[0].station.id, 'alive');
});

test('провал подключения штрафует сильнее отказа пользователя', () => {
  // Поток, который не играет, бесполезен — вес выше, чем у «не подходит».
  const rejected = signalPenalty(signal('x', { rejects: 1 }));
  const broken = signalPenalty(signal('x', { connectFails: 1 }));
  assert.ok(broken < rejected, `${broken} должно быть меньше ${rejected}`);
});

test('пустой список тегов не роняет ранжирование', () => {
  const ranked = rankStations([station('a', ['ambient'])], []);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].atmosphereMatch, 0);
});
