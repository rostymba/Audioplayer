import type { RadioStation } from './types';

type SomaChannel = { id: string; title: string; description: string; genre: string; image: string; playlists: { url: string; format: string }[] };
const SOMA = 'https://somafm.com';
const RP = 'https://api.radioparadise.com';

async function json<T>(url: string, revalidate = 1800): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(4500), next: { revalidate } });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  return response.json();
}

// Editorial mappings supplement the networks' own genre descriptions, not book inference.
const somaTags: Record<string, string[]> = {
  darkzone: ['dark ambient'], doomed: ['dark ambient', 'industrial'],
  deepspaceone: ['space', 'ambient', 'electronic'], spacestation: ['space', 'ambient'],
  synphaera: ['space', 'ambient'], secretagent: ['mystery', 'soundtrack', 'lounge'],
  dronezone: ['ambient', 'relaxation'], dz2: ['ambient', 'relaxation'],
  groovesalad: ['chillout', 'downtempo'], groovesalad2: ['chillout', 'downtempo'],
  gsclassic: ['chillout', 'downtempo'], illstreet: ['lounge'],
  fluid: ['instrumental'], thistle: ['celtic', 'folk'],
};
const excluded = new Set(['sf1033', 'scanner', 'sfinsf', 'missioncontrol', 'live']);

export function normalizeSoma(channel: SomaChannel, url: string): RadioStation {
  const descriptionTags = ['ambient', 'space', 'jazz', 'downtempo', 'instrumental', 'folk']
    .filter(tag => channel.description.toLowerCase().includes(tag));
  return {
    id: `soma:${channel.id}`, source: 'SomaFM', name: `SomaFM ${channel.title}`, url,
    playbackUrl: `/api/radio/stream?stationId=soma:${channel.id}`,
    homepage: `${SOMA}/${channel.id}/`, favicon: channel.image,
    tags: [...new Set([...channel.genre.split('|'), ...descriptionTags, ...(somaTags[channel.id] ?? [])])],
    country: 'The United States Of America', language: '', codec: 'MP3', bitrate: 128, votes: 0,
  };
}

async function somaChannels() {
  const data = await json<{ channels: SomaChannel[] }>(`${SOMA}/channels.json`);
  return data.channels.filter(c => /^[a-z0-9]+$/.test(c.id) && !excluded.has(c.id) && !/spoken|news/.test(c.genre));
}

async function somaStream(channel: SomaChannel) {
  const playlist = channel.playlists.find(p => p.format === 'mp3');
  if (!playlist) throw new Error('No MP3 playlist');
  const target = new URL(playlist.url);
  if (target.protocol !== 'https:' || !['somafm.com', 'api.somafm.com'].includes(target.hostname)) throw new Error('Untrusted playlist');
  const response = await fetch(target, { signal: AbortSignal.timeout(4500), next: { revalidate: 1800 } });
  if (!response.ok) throw new Error('Playlist unavailable');
  const entries = [...(await response.text()).matchAll(/^File\d+=(.+)$/gm)];
  const stream = entries.map(entry => entry[1].trim()).find(value => {
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname.endsWith('.somafm.com'); } catch { return false; }
  });
  if (!stream) throw new Error('No trusted HTTPS stream');
  return stream;
}

export async function resolveSomaStream(id: string) {
  const channel = (await somaChannels()).find(channel => `soma:${channel.id}` === id);
  return channel ? somaStream(channel) : null;
}

export async function discoverSoma(tags: string[]) {
  const channels = (await somaChannels()).filter(c => !tags.length || normalizeSoma(c, '').tags.some(t => tags.includes(t)));
  const stations: RadioStation[] = [];
  // Bound upstream concurrency; one dead channel must not discard the network.
  for (let index = 0; index < channels.length; index += 8) {
    const batch = await Promise.allSettled(channels.slice(index, index + 8).map(async c => normalizeSoma(c, await somaStream(c))));
    stations.push(...batch.flatMap(r => r.status === 'fulfilled' ? [r.value] : []));
  }
  return stations;
}

const paradiseChannels: Record<string, { stream: string; tags: string[] }> = {
  '0': { stream: 'https://stream.radioparadise.com/aac-128', tags: ['eclectic', 'rock', 'world'] },
  '1': { stream: 'https://stream.radioparadise.com/mellow-128', tags: ['mellow', 'chillout', 'acoustic'] },
  '2': { stream: 'https://stream.radioparadise.com/rock-128', tags: ['rock', 'alternative'] },
  '3': { stream: 'https://stream.radioparadise.com/global-128', tags: ['world', 'folk'] },
};

export function resolveParadiseStream(id: string) {
  const channel = id.startsWith('rp:') ? id.slice(3) : '';
  return paradiseChannels[channel]?.stream ?? null;
}

export async function discoverParadise(tags: string[]) {
  const channels = await json<{ chan: string; title: string; image: string }[]>(`${RP}/api/list_chan`);
  return channels.flatMap((channel): RadioStation[] => {
    const mapping = paradiseChannels[channel.chan];
    if (!mapping || (tags.length && !mapping.tags.some(t => tags.includes(t)))) return [];
    return [{ id: `rp:${channel.chan}`, source: 'Radio Paradise', name: `Radio Paradise ${channel.title}`,
      url: mapping.stream, tags: mapping.tags, homepage: 'https://radioparadise.com', favicon: channel.image,
      country: 'The United States Of America', language: '', codec: 'AAC', bitrate: 128, votes: 0 }];
  });
}

export async function directMetadata(id: string): Promise<string | null> {
  if (/^soma:[a-z0-9]+$/.test(id)) {
    const channel = (await somaChannels()).find(c => `soma:${c.id}` === id);
    if (!channel) return null;
    const data = await json<{ songs: { artist: string; title: string }[] }>(`${SOMA}/songs/${channel.id}.json`, 0);
    const song = data.songs[0];
    return song?.title ? [song.artist, song.title].filter(Boolean).join(' - ') : null;
  }
  const channel = id.slice(3);
  if (id.startsWith('rp:') && Object.hasOwn(paradiseChannels, channel)) {
    const song = await json<{ artist: string; title: string }>(`${RP}/api/now_playing?chan=${channel}`, 0);
    return song.title ? [song.artist, song.title].filter(Boolean).join(' - ') : null;
  }
  return null;
}
