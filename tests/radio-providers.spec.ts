import { test, expect } from '@playwright/test';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/radio/route';
import { directMetadata } from '../lib/radio-providers';
import { rankStations } from '../lib/station-match';
import { diversify } from '../lib/radio-selection';
import { GET as stream } from '../app/api/radio/stream/route';

test('direct networks survive a Radio Browser outage and supply their own track metadata', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes('radio-browser.info')) throw new Error('offline');
    if (url.endsWith('channels.json')) return Response.json({ channels: [{ id: 'groovesalad', title: 'Groove Salad',
      description: 'Ambient downtempo', genre: 'ambient', image: '',
      playlists: [{ format: 'mp3', url: 'https://api.somafm.com/groovesalad.pls' }] }] });
    if (url.endsWith('.pls')) return new Response('[playlist]\nFile1=https://ice2.somafm.com/groovesalad-128-mp3\n');
    if (url.includes('list_chan')) return Response.json([{ chan: '1', title: 'Mellow Mix', image: '' }]);
    if (url.includes('/songs/')) return Response.json({ songs: [{ artist: 'Soma artist', title: 'Soma song' }] });
    if (url.includes('now_playing')) return Response.json({ artist: 'RP artist', title: 'RP song' });
    if (url.includes('ice2.somafm.com')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await GET(new NextRequest('http://localhost/api/radio?tags=chillout,ambient'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.stations.map((s: { source: string }) => s.source).sort()).toEqual(['Radio Paradise', 'SomaFM']);
    expect(data.providers[0].status).toBe('unavailable');
    expect(await directMetadata('soma:groovesalad')).toBe('Soma artist - Soma song');
    expect(await directMetadata('rp:1')).toBe('RP artist - RP song');
    expect(await directMetadata('rp:999')).toBeNull();
    const soma = data.stations.find((s: { source: string }) => s.source === 'SomaFM');
    expect(diversify([soma, { ...soma, id: 'rb-duplicate', name: 'Different name', url: 'https://ice6.somafm.com/groovesalad-64-aac' }])).toHaveLength(1);
    const relayed = await stream(new NextRequest('http://localhost/api/radio/stream?stationId=soma:groovesalad'));
    expect(relayed.status).toBe(200);
    expect([...new Uint8Array(await relayed.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await stream(new NextRequest('http://localhost/api/radio/stream?stationId=https://example.com'))).status).toBe(400);
    const dark = { ...data.stations[0], id: 'dark', tags: ['dark ambient'], votes: 0 };
    const popular = { ...dark, id: 'popular', tags: ['ambient'], votes: 5000 };
    expect(rankStations([popular, dark], ['dark ambient', 'ambient'])[0].station.id).toBe('dark');
  } finally { globalThis.fetch = original; }
});

test('searches all eight book tags and retains results when one tag fails', async () => {
  const original = globalThis.fetch;
  const queried: string[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname.includes('radio-browser.info')) {
      const tag = url.searchParams.get('tag')!;
      queried.push(tag);
      if (tag === 'ambient') throw new Error('one tag failed');
      return Response.json(tag === 'folk' ? [{ stationuuid: 'example', name: 'Folk station', url_resolved: 'https://example.com/live',
        homepage: '', favicon: '', tags: 'folk', country: 'France', language: '', codec: 'MP3', bitrate: 128,
        votes: 0, clickcount: 0, lastcheckok: 1 }] : []);
    }
    throw new Error('Direct provider offline');
  };
  try {
    const response = await GET(new NextRequest('http://localhost/api/radio?tags=ambient,space,jazz,piano,classical,world,acoustic,folk'));
    expect(response.status).toBe(200);
    expect(new Set(queried).size).toBe(8);
    expect((await response.json()).stations[0].name).toBe('Folk station');
  } finally { globalThis.fetch = original; }
});
