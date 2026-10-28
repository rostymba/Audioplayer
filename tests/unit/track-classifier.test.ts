import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStreamTitle, isNonMusic } from '../../lib/track-classifier.ts';

test('распознаёт обычный трек «Artist — Track»', () => {
  assert.equal(classifyStreamTitle('Ólafur Arnalds - Near Light', '').category, 'track');
  assert.equal(classifyStreamTitle('Hans Zimmer – Time', '').category, 'track');
});

test('ловит рекламу по маркерам и по телефону', () => {
  assert.equal(classifyStreamTitle('Реклама на нашей волне', '').category, 'ad');
  assert.equal(classifyStreamTitle('Скидки! www.example.com', '').category, 'ad');
  assert.equal(classifyStreamTitle('Звоните 8 800 555 35 35', '').category, 'ad');
});

test('уверенность рекламы достаточна для быстрого приглушения', () => {
  // Гейт срабатывает мгновенно только при confidence >= 0.8 — иначе ждёт дебаунс.
  assert.ok(classifyStreamTitle('Реклама на нашей волне', '').confidence >= 0.8);
});

test('речь и новости — не музыка', () => {
  assert.equal(classifyStreamTitle('Новости в 15:00', '').category, 'talk');
  assert.equal(classifyStreamTitle('Weather update for London', '').category, 'talk');
  assert.equal(isNonMusic('talk'), true);
  assert.equal(isNonMusic('ad'), true);
});

test('пустая строка и имя станции не считаются треком', () => {
  assert.equal(classifyStreamTitle('', '').category, 'unknown');
  assert.equal(classifyStreamTitle(null, '').category, 'unknown');
  assert.equal(classifyStreamTitle('Chillout FM', 'Chillout FM').category, 'jingle');
});

test('неизвестное не трогаем — джингл и unknown терпим', () => {
  assert.equal(isNonMusic('unknown'), false);
  assert.equal(isNonMusic('jingle'), false);
  assert.equal(isNonMusic('track'), false);
});
