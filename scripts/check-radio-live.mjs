import { chromium } from 'playwright';

const origin = process.env.RADIO_TEST_URL || 'http://127.0.0.1:3000';
const response = await fetch(`${origin}/api/radio?tags=ambient,instrumental`);
if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
const data = await response.json();
const seen = new Set();
const candidates = data.stations.filter(station => {
  if (!station.url.startsWith('https:') || !station.country || seen.has(station.country)) return false;
  seen.add(station.country); return true;
}).slice(0, 9);
const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
try {
  for (let index = 0; index < candidates.length; index += 3) {
    await Promise.all(candidates.slice(index, index + 3).map(async station => {
      const page = await browser.newPage();
      try {
        await page.goto(origin);
        const result = await page.evaluate(async url => {
          const audio = document.createElement('audio');
          audio.volume = 0; document.body.append(audio); audio.src = url;
          const result = await new Promise(resolve => {
            const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 10000);
            audio.addEventListener('timeupdate', () => {
              if (audio.currentTime > .3) { clearTimeout(timer); resolve({ ok: true, time: audio.currentTime, streamUrl: audio.currentSrc }); }
            });
            audio.play().catch(error => { clearTimeout(timer); resolve({ ok: false, error: error.message }); });
          });
          audio.pause(); audio.removeAttribute('src'); audio.load();
          return result;
        }, station.url);
        results.push({ stationId: station.id, name: station.name, country: station.country, ...result });
      } finally { await page.close(); }
    }));
  }
} finally { await browser.close(); }
const successfulCountries = new Set(results.filter(result => result.ok).map(result => result.country));
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), successfulCountries: successfulCountries.size, results }, null, 2));
if (successfulCountries.size < 3) process.exitCode = 1;
