import { test, expect } from '@playwright/test';
import { diversify, nextStation } from '../lib/radio-selection';
import type { RadioStation } from '../lib/types';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';

async function openBook(page: Page) {
  const zip = new JSZip();
  zip.file('mimetype','application/epub+zip');
  zip.file('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('book.opf','<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">radio-test</dc:identifier><dc:title>Test reading</dc:title><dc:language>en</dc:language></metadata><manifest><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="text"/></spine></package>');
  zip.file('text.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Reading</title></head><body><p>A quiet morning by the river.</p></body></html>');
  await page.goto('/');
  await expect(page.getByText('Открываем картотеку…')).not.toBeVisible();
  await page.getByLabel('Выбрать EPUB').setInputFiles({name:'test.epub', mimeType:'application/epub+zip', buffer:await zip.generateAsync({type:'nodebuffer'})});
}

const station = (id: string, country: string): RadioStation => ({id, country, name: `Station ${id}`, url: `http://127.0.0.1:3000/test-audio/${id}.wav`, tags: ['ambient'], homepage: '', favicon: '', language: '', codec: 'MP3', bitrate: 128, votes: 0});
const stations = [station('a','France'), station('b','Japan'), station('c','Brazil')];
function wav() {
  const bytes = Buffer.alloc(44 + 8000 * 2 * 300);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8,4); bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(8000,24); bytes.writeUInt32LE(16000,28); bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34);
  bytes.write('data',36); bytes.writeUInt32LE(bytes.length - 44,40);
  return bytes;
}

test('deduplicates codec variants and prefers an unvisited country', () => {
  const first = {...stations[0], name:'SomaFM Groove Salad (128k MP3)'};
  const duplicate = {...first, id:'duplicate', url:'https://example.org/aac', name:'SomaFM Groove Salad (128k AAC)'};
  expect(diversify([first, duplicate, stations[1]])).toHaveLength(2);
  expect(nextStation(stations, stations[0], new Set(['a']))?.country).toBe('Japan');
  expect(nextStation(stations, stations[1], new Set(['a','b']))?.country).toBe('Brazil');
});

test.beforeEach(async ({page}) => {
  await page.route('**/api/radio?**', route => route.fulfill({json:{stations, countries:3, nextOffset:250, hasMore:false}}));
  await page.route('**/api/radio/metadata?**', route => route.fulfill({json:{streamTitle:'Test track'}}));
  await page.route('**/test-audio/**', route => route.fulfill({contentType:'audio/wav', body:wav()}));
});

test('three countries actually play different audio URLs; old deck stops', async ({page}) => {
  await openBook(page);
  const panel = page.locator('.music-panel');
  await expect(panel).toHaveAttribute('data-state','playing');
  for (const id of ['a','b','c']) {
    if (id !== 'a') await page.getByRole('button',{name:'Не подходит'}).click();
    await expect(panel).toHaveAttribute('data-state','playing',{timeout:15000});
    await expect(panel).toHaveAttribute('data-station-id',id);
    const playing = await page.locator('audio').evaluateAll(elements => (elements as HTMLAudioElement[]).filter(a => !a.paused && a.volume > 0).map(a=>({src:a.currentSrc, time:a.currentTime})));
    expect(playing).toHaveLength(1);
    expect(playing[0].src).toContain(`/${id}.wav`);
    expect(playing[0].time).toBeGreaterThan(0);
  }
  await expect(page.locator('.history-item.type-transition')).toHaveCount(2);
  await page.screenshot({path:'test-results/radio-world.png',fullPage:true});
});

test('failed replacement preserves playing station and does not record successful transition', async ({page}) => {
  await page.route('**/test-audio/b.wav', route => route.abort());
  await openBook(page);
  await expect(page.locator('.music-panel')).toHaveAttribute('data-state','playing');
  await page.getByRole('button',{name:'Не подходит'}).click();
  await expect(page.getByText('Ошибка подключения; переход не состоялся')).toBeVisible();
  await expect(page.locator('.music-panel')).toHaveAttribute('data-station-id','a');
  await expect(page.locator('.history-item.type-transition')).toHaveCount(0);
});

test('automatic rotation selects another country after four minutes', async ({page}) => {
  await page.clock.install();
  await openBook(page);
  await expect(page.locator('.music-panel')).toHaveAttribute('data-state','playing');
  await page.clock.fastForward(255000);
  await expect(page.locator('.music-panel')).toHaveAttribute('data-station-id','b');
  await page.clock.runFor(9000);
  await expect(page.locator('.music-panel')).toHaveAttribute('data-state','playing');
  await expect(page.locator('.history-item.type-transition')).toHaveCount(1);
});
