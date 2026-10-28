import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import JSZip from 'jszip';
import type { RadioStation } from '../lib/types';

// Инварианты запуска — ровно те места, на которых мы горели вручную:
// лишние перезапуски подбора, тишина после открытия, игнор скрининга, мёртвые станции.

const station = (id: string, country: string): RadioStation => ({
  id, country, name: `Station ${id}`, url: `http://127.0.0.1:3001/test-audio/${id}.wav`,
  tags: ['ambient'], homepage: '', favicon: '', language: '', codec: 'MP3', bitrate: 128, votes: 0,
});
const stations = [station('a', 'France'), station('b', 'Japan'), station('c', 'Brazil'), station('d', 'Chile')];

function wav() {
  const bytes = Buffer.alloc(44 + 8000 * 2 * 300);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}

type Options = { cleanId?: string | null; deadIds?: string[] };

async function mockBackend(page: Page, options: Options = {}) {
  const catalogInitial: string[] = [];
  // Единый перехватчик: снимает неоднозначность порядка правил и даёт счётчик запросов каталога.
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.includes('/api/radio/audio-guard/screen')) {
      const pick = options.cleanId ?? null;
      return route.fulfill({ json: { status: 'ready', cleanId: pick, bestId: pick, results: [] } });
    }
    if (url.includes('/api/radio/audio-guard')) {
      return route.fulfill({ json: { status: 'ready', verdict: { category: 'music', confidence: 0.9, speech: 0, vocals: 0, music: 0.8, labels: [] } } });
    }
    if (url.includes('/api/radio/metadata')) return route.fulfill({ json: { streamTitle: 'Test track' } });
    if (url.includes('/api/diag')) return route.fulfill({ json: { ok: true } });
    if (url.includes('/api/radio')) {
      if (!url.includes('offset=')) catalogInitial.push(url);
      return route.fulfill({ json: { stations, countries: 4, hasMore: false } });
    }
    return route.fallback();
  });
  // Модель эмбеддингов в тестах не качаем — приложение обязано корректно откатиться на keyword-профиль.
  await page.route('**huggingface.co/**', route => route.abort());
  await page.route('**/test-audio/**', route => {
    const dead = (options.deadIds ?? []).some(id => route.request().url().includes(`/${id}.wav`));
    return dead ? route.abort() : route.fulfill({ contentType: 'audio/wav', body: wav() });
  });
  return { catalogInitial };
}

async function openBook(page: Page) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('book.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">startup-test</dc:identifier><dc:title>Startup</dc:title><dc:language>en</dc:language></metadata><manifest><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="text"/></spine></package>');
  zip.file('text.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Reading</title></head><body><p>A quiet morning by the river.</p></body></html>');
  await page.goto('/');
  await expect(page.getByText('Opening the catalogue…')).not.toBeVisible();
  await page.getByLabel('Choose EPUB').setInputFiles({ name: 'startup.epub', mimeType: 'application/epub+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
}

/** Ждём реально звучащий поток: не на паузе, со звуком и с продвижением времени. */
async function waitForAudio(page: Page, timeout: number) {
  await expect.poll(async () => page.locator('audio').evaluateAll(
    elements => (elements as HTMLAudioElement[]).filter(a => !a.paused && a.volume > 0 && a.currentTime > 0).length,
  ), { timeout, intervals: [250] }).toBeGreaterThan(0);
}

test('подбор станций запускается ровно один раз за открытие книги', async ({ page }) => {
  const { catalogInitial } = await mockBackend(page, { cleanId: 'a' });
  await openBook(page);
  await waitForAudio(page, 25_000);
  // Даём время на возможные лишние перезапуски эффекта — их быть не должно.
  await page.waitForTimeout(8_000);
  expect(catalogInitial).toHaveLength(1);
  await waitForAudio(page, 5_000); // и звук не оборвался
});

test('музыка стартует в пределах бюджета', async ({ page }) => {
  await mockBackend(page, { cleanId: 'a' });
  const startedAt = Date.now();
  await openBook(page);
  await waitForAudio(page, 20_000);
  expect(Date.now() - startedAt).toBeLessThan(20_000);
});

test('играет станция, выбранная скринингом', async ({ page }) => {
  await mockBackend(page, { cleanId: 'c' });
  await openBook(page);
  await waitForAudio(page, 25_000);
  await expect(page.locator('.music-panel')).toHaveAttribute('data-station-id', 'c');
});

test('мёртвые станции не оставляют в тишине', async ({ page }) => {
  // Скрининг выбрал «a», но её поток мёртв, как и «b» — плеер обязан дойти до живой.
  await mockBackend(page, { cleanId: 'a', deadIds: ['a', 'b'] });
  await openBook(page);
  await waitForAudio(page, 30_000);
  const playing = await page.locator('audio').evaluateAll(
    elements => (elements as HTMLAudioElement[]).filter(a => !a.paused && a.volume > 0).map(a => a.currentSrc),
  );
  expect(playing).toHaveLength(1);
  expect(playing[0]).not.toContain('/a.wav');
  expect(playing[0]).not.toContain('/b.wav');
});
