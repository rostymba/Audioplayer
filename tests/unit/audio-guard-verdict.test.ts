import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedVocal, isTalk, musicCategory, needsLanguageCheck, summariseLabels,
  type Label } from '../../lib/audio-guard-verdict.ts';

const labels = (entries: [string, number][]): Label[] => entries.map(([label, score]) => ({ label, score }));

test('суммирует лейблы по семействам', () => {
  const summary = summariseLabels(labels([['Music', 0.5], ['Speech', 0.3], ['Singing', 0.1], ['Dog', 0.9]]));
  assert.equal(summary.music, 0.5);
  assert.equal(summary.speech, 0.3);
  assert.equal(summary.vocals, 0.1);
});

test('речь ведущего/реклама распознаётся как talk', () => {
  assert.equal(isTalk({ music: 0.1, speech: 0.49, vocals: 0 }), true);
  assert.equal(isTalk({ music: 0.2, speech: 0.2, vocals: 0.01 }), true);
});

test('пение не принимается за речь', () => {
  // Вокал заметно выше речи — это песня, а не разговор в эфире.
  assert.equal(isTalk({ music: 0.4, speech: 0.05, vocals: 0.30 }), false);
  assert.equal(isTalk({ music: 0.4, speech: 0.10, vocals: 0.30 }), false);
});

test('тихая инструменталка не считается речью', () => {
  assert.equal(isTalk({ music: 0.6, speech: 0.0006, vocals: 0 }), false);
});

test('порог музыки отделяет music от unknown (граница 0.25 включительно)', () => {
  assert.equal(musicCategory({ music: 0.6, speech: 0, vocals: 0 }), 'music');
  assert.equal(musicCategory({ music: 0.20, speech: 0, vocals: 0.05 }), 'music', 'ровно 0.25 — это уже музыка');
  assert.equal(musicCategory({ music: 0.20, speech: 0, vocals: 0.04 }), 'unknown', '0.24 — ниже порога');
  // Классика часто недобирает: инструменты (Cello, Violin) не входят в MUSIC_PATTERNS.
  assert.equal(musicCategory({ music: 0.144, speech: 0, vocals: 0 }), 'unknown');
});

test('язык проверяем только для русского и только при вокале', () => {
  assert.equal(needsLanguageCheck('ru', 0.2), true);
  assert.equal(needsLanguageCheck('ru', 0.001), false, 'на инструменталке whisper не гоняем');
  assert.equal(needsLanguageCheck('en', 0.5), false);
  assert.equal(needsLanguageCheck('', 0.5), false);
});

test('русский вокал блокируется только при достаточной уверенности', () => {
  assert.equal(isBlockedVocal({ language: 'ru', confidence: 0.4 }), true);
  assert.equal(isBlockedVocal({ language: 'ru', confidence: 0.1 }), false);
  assert.equal(isBlockedVocal({ language: 'en', confidence: 0.9 }), false);
});
