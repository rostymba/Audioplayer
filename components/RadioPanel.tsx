"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AtmosphereProfile, HistoryEntry, RadioStation } from "@/lib/types";
import { diversify, initialStationsForBook, nextStation, rememberBookStation, type BookStationMemory } from '@/lib/radio-selection';
import { RADIO_TUNING } from '@/lib/radio-tuning';
import { classifyStreamTitle, isLikelyRussianText, isNonMusic } from '@/lib/track-classifier';
import { getLearningStore, type LearningEvent, type StationSignal } from '@/lib/learning-store';
import { rankStations } from '@/lib/station-match';

type PlayerState = "searching" | "ready" | "playing" | "paused" | "transitioning" | "error";
type GuardVerdict = { category: 'music' | 'talk' | 'russian-vocal' | 'unknown'; confidence: number; speech: number; vocals: number; music: number; transcript?: string };

const TARGET_VOLUME = 0.62;
const CROSSFADE_MS = 8_000;
const PROFILE_LABELS: Record<AtmosphereProfile['key'], string> = {
  dark: 'Dark intensity',
  fantasy: 'Mythic expanse',
  cozy: 'Quiet warmth',
  cosmic: 'Cosmic signal',
  mystery: 'Hidden tension',
  classic: 'Printed classic',
  neutral: 'Calm background',
};

/**
 * Проверяет, отвечает ли поток, на отдельном временном элементе — чтобы не занимать деки.
 * Нужна для параллельной гонки запасных кандидатов: последовательный перебор стоил
 * по 8 секунд тишины на каждый мёртвый поток.
 */
function probeStation(station: RadioStation, timeoutMs: number): Promise<RadioStation | null> {
  return new Promise(resolve => {
    const audio = new Audio();
    audio.muted = true;
    audio.preload = 'auto';
    const finish = (responsive: boolean) => {
      window.clearTimeout(timer);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.removeAttribute('src');
      resolve(responsive ? station : null);
    };
    const onReady = () => finish(true);
    const onError = () => finish(false);
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    audio.addEventListener('canplay', onReady, { once: true });
    audio.addEventListener('error', onError, { once: true });
    audio.src = station.playbackUrl ?? station.url;
    audio.load();
  });
}

/** Первый ответивший из списка; null — если не ответил никто. */
async function firstResponsive(stations: RadioStation[], timeoutMs: number): Promise<RadioStation | null> {
  if (!stations.length) return null;
  return new Promise(resolve => {
    let pending = stations.length;
    let settled = false;
    stations.forEach(station => {
      void probeStation(station, timeoutMs).then(result => {
        pending -= 1;
        if (settled) return;
        if (result) { settled = true; resolve(result); }
        else if (pending === 0) { settled = true; resolve(null); }
      });
    });
  });
}

function waitUntilReady(audio: HTMLAudioElement) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error("The stream did not respond in time")), RADIO_TUNING.connectTimeoutMs);
    const onReady = () => finish();
    const onError = () => finish(new Error("The station is unavailable"));
    function finish(error?: Error) {
      window.clearTimeout(timeout);
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("error", onError);
      if (error) reject(error); else resolve();
    }
    audio.addEventListener("canplay", onReady, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.load();
  });
}

export function RadioPanel({
  bookId,
  bookLanguage,
  atmosphere,
  refinedTags,
  analysisReady = true,
}: {
  bookId: string;
  bookLanguage: string;
  atmosphere: AtmosphereProfile;
  refinedTags?: string[] | null;
  analysisReady?: boolean;
}) {
  const deckA = useRef<HTMLAudioElement>(null);
  const deckB = useRef<HTMLAudioElement>(null);
  const activeDeck = useRef<"a" | "b">("a");
  const animationFrame = useRef<number | null>(null);
  const volumeRef = useRef(TARGET_VOLUME);
  const switching = useRef(false);
  const visited = useRef(new Set<string>());
  const lastSwitch = useRef(0);
  const lastTitle = useRef('');
  const generation = useRef(0);
  const autoplayBlocked = useRef(false);
  const finishFade = useRef<(() => void) | null>(null);
  const duckFrame = useRef<number | null>(null);
  const ducked = useRef(false);
  const escalationDeadline = useRef<number | null>(null);
  const classBuffer = useRef<string[]>([]);
  const guardBuffer = useRef<string[]>([]);
  const lastGuardAction = useRef('');
  const stationsRef = useRef<RadioStation[]>([]);
  const currentRef = useRef<RadioStation | null>(null);
  const denylist = useRef<Set<string>>(new Set());
  const signalsMap = useRef<Map<string, StationSignal>>(new Map());
  const lastDuckCategory = useRef<'ad' | 'talk' | null>(null);
  const reserveStationRef = useRef<RadioStation | null>(null);
  const reserveVersion = useRef(0);
  const diagnosticLog = useRef<Array<Record<string, unknown>>>([]);
  const audioSnapshot = useCallback(() => [deckA.current, deckB.current].map((audio, index) => ({
    deck: index === 0 ? 'a' : 'b', active: activeDeck.current === (index === 0 ? 'a' : 'b'),
    src: audio?.getAttribute('src'), currentSrc: audio?.currentSrc,
    paused: audio?.paused, volume: audio?.volume, time: audio?.currentTime,
    readyState: audio?.readyState, networkState: audio?.networkState,
    error: audio?.error ? {code: audio.error.code, message: audio.error.message} : null,
  })), []);
  const report = useCallback((event: string, data: Record<string, unknown> = {}) => {
    void fetch('/api/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data }), keepalive: true }).catch(() => {});
  }, []);

  const trace = useCallback((event: string, details: Record<string, unknown> = {}) => {
    diagnosticLog.current.push({timestamp: new Date().toISOString(), event, stationId: currentRef.current?.id,
      switching: switching.current, ducked: ducked.current, ...details, audio: audioSnapshot()});
    if (diagnosticLog.current.length > 300) diagnosticLog.current.shift();
  }, [audioSnapshot]);
  useEffect(() => {
    const events = ['loadstart', 'canplay', 'playing', 'pause', 'waiting', 'stalled', 'error', 'ended', 'emptied', 'abort'];
    const cleanups = [deckA.current, deckB.current].flatMap((audio, index) => {
      if (!audio) return [];
      return events.map(event => {
        const handler = () => trace(`audio.${event}`, {deck: index === 0 ? 'a' : 'b'});
        audio.addEventListener(event, handler);
        return () => audio.removeEventListener(event, handler);
      });
    });
    return () => cleanups.forEach(cleanup => cleanup());
  }, [trace]);
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [current, setCurrent] = useState<RadioStation | null>(null);
  const [streamTitle, setStreamTitle] = useState<string | null>(null);
  const [state, setState] = useState<PlayerState>("searching");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [message, setMessage] = useState("Reading the book atmosphere…");
  const [, setGuardState] = useState<'warming' | 'active' | 'unavailable'>('warming');
  const queryTags = refinedTags?.length ? refinedTags : atmosphere.tags;
  // Эффект поиска завязан на СОДЕРЖИМОЕ тегов, а не на ссылку массива: иначе новый рендер
  // с теми же тегами перезапускал discover(), а его cleanup глушит оба дека — звук пропадал.
  const tagsKey = queryTags.join(',');
  // Диагностика: один и тот же instanceId при разных runCount = перезапуск эффекта;
  // разный instanceId = перемонтирование компонента.
  const instanceId = useRef('');
  const discoverRun = useRef(0);
  const stationMemory = useCallback((): BookStationMemory => {
    try {
      const value = JSON.parse(localStorage.getItem('audioplayer:book-stations') ?? '{}');
      return { assignments: value.assignments ?? {}, recent: Array.isArray(value.recent) ? value.recent : [] };
    } catch { return { assignments: {}, recent: [] }; }
  }, []);

  const addHistory = useCallback((entry: Omit<HistoryEntry, "id" | "timestamp">) => {
    setHistory((items) => [{ ...entry, id: crypto.randomUUID(), timestamp: Date.now() }, ...items].slice(0, 40));
  }, []);

  const getDecks = useCallback(() => {
    const a = deckA.current;
    const b = deckB.current;
    if (!a || !b) return null;
    return activeDeck.current === "a" ? { active: a, standby: b, next: "b" as const } : { active: b, standby: a, next: "a" as const };
  }, []);

  const duckTo = useCallback((target: number) => {
    const decks = getDecks();
    if (!decks) return;
    const deck = decks.active;
    if (duckFrame.current) cancelAnimationFrame(duckFrame.current);
    const start = performance.now();
    const from = deck.volume;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / RADIO_TUNING.duckFadeMs);
      deck.volume = Math.max(0, from + (target - from) * progress);
      if (progress < 1) duckFrame.current = requestAnimationFrame(step);
    };
    duckFrame.current = requestAnimationFrame(step);
  }, [getDecks]);

  const chooseNext = useCallback((cur: RadioStation | null): RadioStation | undefined => {
    const all = stationsRef.current;
    const allowed = all.filter((s) => !denylist.current.has(s.id));
    let next = nextStation(allowed, cur, visited.current) ?? nextStation(all, cur, visited.current);
    if (!next) { visited.current.clear(); next = nextStation(all, cur, visited.current); }
    return next;
  }, []);

  const record = useCallback((action: LearningEvent['action'], station: RadioStation | null, title?: string) => {
    if (!station) return;
    void getLearningStore()
      .record({ stationId: station.id, streamTitle: title, atmosphereKey: atmosphere.key, action, timestamp: Date.now() })
      .catch(() => {});
  }, [atmosphere.key]);

  const loadSignals = useCallback(async () => {
    try {
      const signals = await getLearningStore().signals(atmosphere.key);
      const map = new Map<string, StationSignal>();
      const deny = new Set<string>();
      for (const signal of signals) {
        map.set(signal.stationId, signal);
        if (signal.rejects * 1.5 + signal.adHits + signal.talkHits + signal.connectFails * 2 - signal.playedOk >= 2) deny.add(signal.stationId);
      }
      signalsMap.current = map;
      denylist.current = deny;
    } catch {
      // Общее поле — best-effort; его недоступность не блокирует подбор.
    }
  }, [atmosphere.key]);

  // Быстрая проверка эфира станции по ICY: музыка / не музыка / неизвестно (короткий таймаут).
  const vetStation = useCallback(async (station: RadioStation): Promise<'music' | 'nonmusic' | 'unknown'> => {
    if (station.id.startsWith('custom:')) return 'unknown';
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 2500);
      const response = await fetch(`/api/radio/metadata?stationId=${encodeURIComponent(station.id)}`, { signal: controller.signal });
      window.clearTimeout(timer);
      const data = (await response.json()) as { streamTitle?: string | null };
      const { category } = classifyStreamTitle(data.streamTitle ?? null, station.name);
      if (isNonMusic(category)) return 'nonmusic';
      const guardTimer = window.setTimeout(() => controller.abort(), 22_000);
      const guard = await fetch(`/api/radio/audio-guard?stationId=${encodeURIComponent(station.id)}&blockedLanguage=${encodeURIComponent(bookLanguage)}`, { signal: controller.signal });
      window.clearTimeout(guardTimer);
      if (guard.ok) {
        const result = await guard.json() as { verdict?: GuardVerdict };
        if (result.verdict?.category === 'talk' || result.verdict?.category === 'russian-vocal') return 'nonmusic';
        if (result.verdict?.category === 'music') return 'music';
      }
      return category === 'track' ? 'music' : 'unknown';
    } catch {
      return 'unknown';
    }
  }, [bookLanguage]);

  // Готовим резерв заранее и ПРОВЕРЯЕМ его на чистоту в фоне: до 3 кандидатов, приземляемся
  // только на музыку/неизвестно, рекламные пропускаем. Так promote после «не подходит»/эскалации
  // мгновенный и без рекламы. Резерв держится на паузе (volume 0) — инвариант «один поток» цел.
  const prepareReserve = useCallback(async (base: RadioStation | null) => {
    const decks = getDecks();
    if (!decks) return;
    const version = ++reserveVersion.current;
    const operation = generation.current;
    const stillValid = () => version === reserveVersion.current && operation === generation.current
      && !switching.current && decks.standby === getDecks()?.standby;
    const cur = base ?? currentRef.current;
    const pool = stationsRef.current;
    const tried = new Set<string>();
    let fallback: RadioStation | undefined;
    let clean: RadioStation | undefined;
    for (let i = 0; i < 3; i += 1) {
      const allowed = pool.filter((entry) => !denylist.current.has(entry.id) && !tried.has(entry.id));
      const candidate = nextStation(allowed, cur, visited.current)
        ?? nextStation(pool.filter((entry) => !tried.has(entry.id)), cur, visited.current);
      if (!candidate) break;
      tried.add(candidate.id);
      if (!fallback) fallback = candidate;
      const verdict = await vetStation(candidate);
      if (!stillValid()) return;
      if (verdict !== 'nonmusic') { clean = candidate; break; }
    }
    const reserve = clean ?? fallback;
    if (!reserve || !stillValid()) return;
    trace('reserve.assign', {reserveId: reserve.id, reserveUrl: reserve.url, targetIsNowActive: decks.standby === getDecks()?.active});
    reserveStationRef.current = null;
    try {
      decks.standby.src = reserve.playbackUrl ?? reserve.url;
      decks.standby.volume = 0;
      // Ждём реального canplay: иначе на рекламе мы переключались на поток, который не играет,
      // и ждали таймаут уже в тишине. Готовым резерв считается только после этого.
      await waitUntilReady(decks.standby);
      if (!stillValid()) return;
      reserveStationRef.current = reserve;
      trace('reserve.ready', { reserveId: reserve.id });
    } catch {
      record('connect-fail', reserve);
      report('client.reserve-failed', { stationId: reserve.id, name: reserve.name });
      decks.standby.pause();
      decks.standby.removeAttribute('src');
    }
  }, [getDecks, vetStation, trace, record, report]);

  // Куда переключаться: сначала проверенный резерв, иначе — обычный выбор.
  const promoteTarget = useCallback((cur: RadioStation | null): RadioStation | undefined => {
    const reserve = reserveStationRef.current;
    if (reserve && reserve.id !== cur?.id && !visited.current.has(reserve.id) && stationsRef.current.some((entry) => entry.id === reserve.id)) {
      return reserve;
    }
    return chooseNext(cur);
  }, [chooseNext]);

  const switchTo = useCallback(async (station: RadioStation, reason: string, first = false) => {
    trace('switch.request', {targetId: station.id, targetUrl: station.url, reason, first});
    if (switching.current) return false;
    const decks = getDecks();
    if (!decks) return false;
    reserveVersion.current += 1;
    reserveStationRef.current = null;
    if (duckFrame.current) cancelAnimationFrame(duckFrame.current);
    switching.current = true;
    const operation = generation.current;
    autoplayBlocked.current = false;
    visited.current.add(station.id);
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    const { active, standby, next } = decks;
    setState(first ? "ready" : "transitioning");
    setMessage(first ? "Connecting the live stream" : "Preparing a smooth transition");
    standby.src = station.playbackUrl ?? station.url;
    standby.volume = 0;
    try {
      await waitUntilReady(standby);
      if (operation !== generation.current) return false;
      await standby.play();
      if (operation !== generation.current) return false;
    } catch (error) {
      if (operation !== generation.current) return false;
      report('client.connect-failed', { stationId: station.id, name: station.name, first,
        reason: error instanceof Error ? error.message : String(error),
        url: station.playbackUrl ?? station.url,
        // Отличает «поток медленный» (readyState 0, networkState 2) от жёсткой ошибки
        // (error.code: 2 сеть, 3 декодирование, 4 формат не поддержан).
        mediaError: standby.error ? { code: standby.error.code, message: standby.error.message } : null,
        readyState: standby.readyState, networkState: standby.networkState });
      // Станция, которая не завелась, должна перестать попадаться — это сигнал общего поля.
      record('connect-fail', station);
      autoplayBlocked.current = error instanceof DOMException && error.name === 'NotAllowedError';
      switching.current = false;
      standby.pause();
      if (!active.paused && active.src) {
        setState('playing');
        setMessage('The new station is unavailable — keeping the current stream');
        addHistory({type: 'system', stationName: station.name, stationId: station.id, country: station.country, detail: 'Connection failed; transition cancelled'});
        return false;
      }
      setState(error instanceof DOMException && error.name === "NotAllowedError" ? "paused" : "error");
      setMessage(error instanceof DOMException && error.name === "NotAllowedError" ? "Press play — the browser is waiting for you" : "This stream did not respond. Try another one.");
      setCurrent(station);
      activeDeck.current = next;
      addHistory({ type: "system", stationName: station.name, detail: "Autoplay unavailable" });
      return false;
    }

    setCurrent(station);
    setStreamTitle(null);
    lastTitle.current = '';

    if (first || active.paused || !active.src) {
      active.pause();
      active.removeAttribute("src");
      standby.volume = volumeRef.current;
      activeDeck.current = next;
      setState("playing");
      setMessage("Live stream");
      switching.current = false;
      lastSwitch.current = Date.now();
      addHistory({type: 'station', stationName: station.name, stationId: station.id, country: station.country, streamUrl: station.url, detail: reason});
      report('client.playing', { stationId: station.id, name: station.name, first: true });
      ducked.current = false;
      escalationDeadline.current = null;
      classBuffer.current = [];
      prepareReserve(station);
      return true;
    }

    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      finishFade.current = resolve;
      function tick(now: number) {
        const progress = Math.min(1, (now - startedAt) / CROSSFADE_MS);
        const theta = progress * Math.PI * 0.5;
        active.volume = Math.max(0, Math.cos(theta) * volumeRef.current);
        standby.volume = Math.max(0, Math.sin(theta) * volumeRef.current);
        if (progress < 1) animationFrame.current = requestAnimationFrame(tick);
        else resolve();
      }
      animationFrame.current = requestAnimationFrame(tick);
    });
    finishFade.current = null;
    if (operation !== generation.current) return false;
    active.pause();
    active.removeAttribute("src");
    active.load();
    activeDeck.current = next;
    setState("playing");
    setMessage("New station on air");
    switching.current = false;
    lastSwitch.current = Date.now();
    addHistory({type: 'transition', stationName: station.name, stationId: station.id, country: station.country, streamUrl: station.url, detail: reason});
    ducked.current = false;
    escalationDeadline.current = null;
    classBuffer.current = [];
    prepareReserve(station);
    return true;
  }, [addHistory, getDecks, prepareReserve, trace, report, record]);

  useEffect(() => { stationsRef.current = stations; }, [stations]);
  useEffect(() => { currentRef.current = current; }, [current]);

  useEffect(() => {
    if (!analysisReady) return;
    let cancelled = false;
    const audioA = deckA.current;
    const audioB = deckB.current;
    async function discover() {
      setState("searching");
      setMessage(`Searching: ${queryTags.join(" · ")}`);
      ducked.current = false;
      escalationDeadline.current = null;
      classBuffer.current = [];
      try {
        if (!instanceId.current) instanceId.current = Math.random().toString(36).slice(2, 8);
        const runNo = ++discoverRun.current;
        const response = await fetch(`/api/radio?tags=${encodeURIComponent(queryTags.join(","))}`
          + `&_i=${instanceId.current}&_r=${runNo}&_ready=${analysisReady ? 1 : 0}&_book=${encodeURIComponent(bookId)}`);
        const data = (await response.json()) as { stations?: RadioStation[]; providers?: unknown; error?: string; hasMore?: boolean; nextOffset?: number };
        if (!response.ok || !data.stations?.length) throw new Error(data.error || "No matching stations found");
        if (cancelled) return;
        await loadSignals();
        // Рычаг B: ранжируем по близости к атмосфере (× доступность, − сигналы общего поля).
        const ranked = rankStations(data.stations, queryTags, signalsMap.current);
        // Deduplicate without country round-robin undoing atmosphere ranking.
        const unique = new Set(diversify(data.stations).map(station => station.id));
        const rankedStations = ranked.map(entry => entry.station).filter(station => unique.has(station.id));
        const ordered = initialStationsForBook(rankedStations, bookId, stationMemory());
        trace('catalog.loaded', { tags: queryTags, providers: data.providers, count: ordered.length,
          top: ranked.slice(0, 10).map(entry => ({ id: entry.station.id, source: entry.station.source, score: entry.score, match: entry.atmosphereMatch })) });
        if (cancelled) return;
        setStations(ordered);
        visited.current.clear();

        // Вариант B: до первого включения проверяем несколько волн на рекламу/речь и стартуем
        // с первой чистой. Сэмплы качаются параллельно, поэтому проверка укладывается в ~5-6 c.
        // Любой сбой или таймаут — играем как раньше, лишь бы не оставить пользователя в тишине.
        let startOrder = ordered;
        const shortlist = ordered.slice(0, RADIO_TUNING.startupScreenCandidates);
        if (shortlist.length > 1) {
          setMessage('Checking the air for ads and speech…');
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), RADIO_TUNING.startupScreenTimeoutMs);
          try {
            const screened = await fetch('/api/radio/audio-guard/screen', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                stationIds: shortlist.map(entry => entry.id),
                blockedLanguage: bookLanguage,
                seconds: RADIO_TUNING.startupScreenSeconds,
              }),
              signal: controller.signal,
            });
            if (screened.ok) {
              const result = await screened.json() as { cleanId?: string | null; bestId?: string | null; results?: unknown };
              trace('startup.screened', { cleanId: result.cleanId, bestId: result.bestId, shortlist: shortlist.map(entry => entry.id), results: result.results });
              const pickId = result.cleanId ?? result.bestId ?? null;
              const winner = pickId ? ordered.find(entry => entry.id === pickId) : undefined;
              if (winner) startOrder = [winner, ...ordered.filter(entry => entry.id !== winner.id)];
            } else {
              trace('startup.screen-skipped', { status: screened.status });
            }
          } catch {
            trace('startup.screen-skipped', { status: 'timeout' });
          } finally {
            window.clearTimeout(timer);
          }
        }
        if (cancelled) return;

        const reason = `Matched to the “${PROFILE_LABELS[atmosphere.key]}” profile`;
        const remember = (station: RadioStation) =>
          localStorage.setItem('audioplayer:book-stations', JSON.stringify(rememberBookStation(stationMemory(), bookId, station.id)));

        // Победителю скрининга даём собственную попытку: он уже проверен сервером на чистоту.
        const shortlistToPlay = startOrder.slice(0, RADIO_TUNING.startupConnectAttempts);
        const [preferred, ...backups] = shortlistToPlay;
        let started = preferred ? await switchTo(preferred, reason, true) : false;
        if (started && preferred) remember(preferred);

        // Запасные пробуем ПАРАЛЛЕЛЬНО: иначе каждый мёртвый поток добавлял 8 секунд тишины.
        if (!started && !autoplayBlocked.current && !cancelled && backups.length) {
          const responsive = await firstResponsive(backups, RADIO_TUNING.fallbackProbeMs);
          report('client.fallback-probe', { tried: backups.map(entry => entry.id), responsive: responsive?.id ?? null });
          if (responsive && !cancelled) {
            started = await switchTo(responsive, reason, true);
            if (started) remember(responsive);
          }
        }
        let more = data.hasMore;
        let offset = data.nextOffset;
        while (!cancelled && more && offset !== undefined) {
          const nextResponse = await fetch(`/api/radio?tags=${encodeURIComponent(queryTags.join(','))}&offset=${offset}`);
          if (!nextResponse.ok || cancelled) break;
          const page = await nextResponse.json();
          if (cancelled) break;
          setStations(items => rankStations(diversify([...items, ...page.stations]), queryTags, signalsMap.current).map(entry => entry.station));
          more = page.hasMore;
          if (page.nextOffset <= offset) break;
          offset = page.nextOffset;
        }
      } catch (error) {
        if (cancelled) return;
        setState("error");
        setMessage(error instanceof Error ? error.message : "Could not find a radio stream");
      }
    }
    void discover();
    return () => {
      cancelled = true;
      generation.current += 1;
      reserveVersion.current += 1;
      reserveStationRef.current = null;
      switching.current = false;
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
      if (duckFrame.current) cancelAnimationFrame(duckFrame.current);
      finishFade.current?.();
      // ВАЖНО: деки здесь НЕ глушим. Повторный запуск эффекта (смена ссылки в зависимостях)
      // раньше обрывал уже игравший эфир — отсюда были секунды тишины. Остановка звука
      // теперь живёт в отдельном эффекте ниже и срабатывает только при смене книги/размонтировании.
      void audioA; void audioB;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ключ по содержимому тегов (tagsKey), см. выше
  }, [analysisReady, tagsKey, atmosphere.key, bookId, bookLanguage, stationMemory, switchTo, loadSignals, trace]);

  // Останавливаем эфир только когда действительно уходим: другая книга или размонтирование.
  useEffect(() => {
    const a = deckA.current;
    const b = deckB.current;
    return () => {
      [a, b].forEach((audio) => { audio?.pause(); audio?.removeAttribute('src'); });
    };
  }, [bookId]);

  useEffect(() => {
    if (!current || current.id.startsWith('custom:')) return;
    let cancelled = false;
    async function readMetadata() {
      let title: string | null = null;
      try {
        const response = await fetch(`/api/radio/metadata?stationId=${encodeURIComponent(current!.id)}`);
        const data = (await response.json()) as { streamTitle?: string | null };
        title = data.streamTitle ?? null;
        if (!cancelled && title) {
          setStreamTitle(title);
          if (title !== lastTitle.current) {
            lastTitle.current = title;
            addHistory({type: 'track', stationName: current!.name, stationId: current!.id, country: current!.country, streamTitle: title, detail: 'Title received from stream metadata'});
          }
        }
      } catch {
        // Many stations do not expose ICY metadata; station-level matching remains valid.
      }
      if (cancelled) return;
      // Гейт чистых треков (C.1): классифицируем эфир и приглушаем на рекламе/речи.
      const { category, confidence } = classifyStreamTitle(title, current!.name);
      trace('metadata.classified', {title, category, confidence});
      const russianMetadata = /^(ru|rus|russian)(-|$)/i.test(bookLanguage) && isLikelyRussianText(title);
      if (russianMetadata && !switching.current) {
        const target = promoteTarget(current!);
        if (target) {
          record('skip-mismatch', current!, title ?? undefined);
          addHistory({type: 'system', stationName: current!.name, stationId: current!.id, country: current!.country,
            detail: 'Metadata indicates Russian lyrics; switching the stream'});
          void switchTo(target, 'Russian vocals excluded by metadata');
          return;
        }
      }
      const buffer = classBuffer.current;
      buffer.push(category);
      if (buffer.length > RADIO_TUNING.debounceReads) buffer.shift();
      const stable = buffer.length >= RADIO_TUNING.debounceReads && buffer.every((entry) => entry === category);
      const fastAd = isNonMusic(category) && confidence >= 0.8;
      if (isNonMusic(category) && confidence >= 0.6 && (stable || fastAd) && !ducked.current && !switching.current) {
        const target = promoteTarget(current!);
        if (target) {
          record(category === 'talk' ? 'skip-talk' : 'skip-ad', current!, title ?? undefined);
          addHistory({type: 'system', stationName: current!.name, stationId: current!.id, country: current!.country, detail: `Metadata indicates ${category === 'talk' ? 'speech' : 'advertising'}; switching the stream`});
          void switchTo(target, category === 'talk' ? 'Presenter speech detected' : 'Advertising detected');
        } else {
          ducked.current = true;
          lastDuckCategory.current = category === 'talk' ? 'talk' : 'ad';
          duckTo(RADIO_TUNING.duckTargetVolume);
          escalationDeadline.current = Date.now() + RADIO_TUNING.escalationWindowNoReserveMs;
          setMessage('Advertising or speech detected — searching for clean audio');
          addHistory({type: 'system', stationName: current!.name, stationId: current!.id, country: current!.country, detail: `Non-music content (${category}); volume reduced`});
        }
      } else if (category === 'track' && ducked.current && !switching.current) {
        ducked.current = false;
        escalationDeadline.current = null;
        duckTo(volumeRef.current);
        setMessage('Live stream');
      }
    }
    void readMetadata();
    const timer = window.setInterval(readMetadata, RADIO_TUNING.icyPollMs);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [current, bookLanguage, addHistory, duckTo, promoteTarget, record, switchTo, trace]);

  useEffect(() => {
    if (!current || state !== 'playing') return;
    let cancelled = false;
    let running = false;
    guardBuffer.current = [];
    lastGuardAction.current = '';
    async function inspectAudio() {
      if (running || cancelled || switching.current) return;
      running = true;
      try {
        const response = await fetch(`/api/radio/audio-guard?stationId=${encodeURIComponent(current!.id)}&blockedLanguage=${encodeURIComponent(bookLanguage)}`);
        if (response.status === 202) { setGuardState('warming'); return; }
        if (!response.ok) { setGuardState('unavailable'); return; }
        const data = await response.json() as { verdict?: GuardVerdict };
        const verdict = data.verdict;
        if (!verdict || cancelled || currentRef.current?.id !== current!.id) return;
        setGuardState('active');
        trace('audio-guard.classified', verdict as unknown as Record<string, unknown>);
        const blocked = verdict.category === 'talk' || verdict.category === 'russian-vocal';
        if (!blocked) { guardBuffer.current = []; return; }
        guardBuffer.current.push(verdict.category);
        if (guardBuffer.current.length > 2) guardBuffer.current.shift();
        const stable = guardBuffer.current.length === 2 && guardBuffer.current.every(value => value === verdict.category);
        const strong = verdict.category === 'russian-vocal' || verdict.speech >= 0.2 || verdict.confidence >= 0.8;
        const actionKey = `${current!.id}:${verdict.category}`;
        if ((!stable && !strong) || lastGuardAction.current === actionKey || switching.current) return;
        const target = promoteTarget(current!);
        if (!target) {
          ducked.current = true;
          duckTo(RADIO_TUNING.duckTargetVolume);
          setMessage('Audio Guard detected speech, but no reserve is available yet');
          return;
        }
        lastGuardAction.current = actionKey;
        const russian = verdict.category === 'russian-vocal';
        record(russian ? 'skip-mismatch' : 'skip-talk', current!, verdict.transcript);
        addHistory({type: 'system', stationName: current!.name, stationId: current!.id, country: current!.country,
          detail: russian ? 'Audio Guard: Russian vocals detected' : 'Audio Guard: speech detected'});
        setMessage(russian ? 'Russian vocals — switching stations' : 'Speech or advertising — switching stations');
        void switchTo(target, russian ? 'Russian vocals excluded' : 'Speech detected');
      } catch {
        if (!cancelled) setGuardState('unavailable');
      } finally { running = false; }
    }
    void inspectAudio();
    const timer = window.setInterval(inspectAudio, RADIO_TUNING.audioGuardPollMs);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [current, state, bookLanguage, addHistory, duckTo, promoteTarget, record, switchTo, trace]);

  useEffect(() => {
    if (state !== 'playing' || !current) return;
    const timer = window.setInterval(() => {
      if (switching.current) return;
      const now = Date.now();
      // Эскалация C.1: приглушены дольше окна ожидания — сменить станцию (с учётом кулдауна).
      if (ducked.current && escalationDeadline.current && now >= escalationDeadline.current) {
        if (now - lastSwitch.current < RADIO_TUNING.switchCooldownMs) return;
        const next = promoteTarget(current);
        if (next) {
          record(lastDuckCategory.current === 'talk' ? 'skip-talk' : 'skip-ad', current);
          void switchTo(next, 'The stream moved to speech or advertising');
        } else {
          ducked.current = false;
          escalationDeadline.current = null;
          duckTo(volumeRef.current);
          setMessage('Live stream');
        }
        return;
      }
      // Атмосферная ротация: только вне приглушения и после минимального удержания.
      if (ducked.current || now - lastSwitch.current < RADIO_TUNING.atmosphereDwellMs) return;
      const next = promoteTarget(current);
      if (next) {
        record('played-ok', current);
        void switchTo(next, 'Automatic rotation: matching genre, another country preferred');
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [state, current, stations, switchTo, duckTo, chooseNext, record, promoteTarget]);

  async function rejectCurrent() {
    if (!stations.length || !current) return;
    record('reject', current, streamTitle ?? undefined);
    addHistory({ type: "rejected", stationName: current.name, streamTitle: streamTitle ?? undefined, detail: "Marked as not a match" });
    const next = promoteTarget(current);
    if (next) await switchTo(next, "Another station based on your feedback");
  }

  const atmosphereStyle = { "--mood-a": atmosphere.colors[0], "--mood-b": atmosphere.colors[1] } as React.CSSProperties;

  return (
    <aside
      className="music-panel"
      style={atmosphereStyle}
      data-state={state}
      data-station-id={current?.id}
      data-message={message}
      data-station-events={history.filter((entry) => entry.type === "station").length}
      data-transition-events={history.filter((entry) => entry.type === "transition").length}
      aria-label="Radio controls"
    >
      <audio ref={deckA} preload="none" />
      <audio ref={deckB} preload="none" />
      <button
        className="radio-strip-skip"
        onClick={() => void rejectCurrent()}
        disabled={!current || state === "searching" || state === 'transitioning'}
        aria-label={current ? `Skip ${current.name}` : 'Skip station'}
      >
        <span className="radio-strip-action">SKIP</span>
        <span className="radio-strip-sep" aria-hidden="true">|</span>
        <span className="radio-strip-name">{current?.name || "Atmosphere Radio"}</span>
      </button>
    </aside>
  );
}
