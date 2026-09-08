"use client";

import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  History,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AtmosphereProfile, HistoryEntry, RadioStation } from "@/lib/types";
import { diversify, nextStation } from '@/lib/radio-selection';

type PlayerState = "searching" | "ready" | "playing" | "paused" | "transitioning" | "error";

const TARGET_VOLUME = 0.62;
const CROSSFADE_MS = 8_000;

function waitUntilReady(audio: HTMLAudioElement) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error("Поток не ответил вовремя")), 8_000);
    const onReady = () => finish();
    const onError = () => finish(new Error("Радиостанция недоступна"));
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
  atmosphere,
  collapsed,
  onToggle,
}: {
  atmosphere: AtmosphereProfile;
  collapsed: boolean;
  onToggle: () => void;
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
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [current, setCurrent] = useState<RadioStation | null>(null);
  const [streamTitle, setStreamTitle] = useState<string | null>(null);
  const [state, setState] = useState<PlayerState>("searching");
  const [volume, setVolume] = useState(TARGET_VOLUME);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [message, setMessage] = useState("Ищем эфир под атмосферу книги");

  const addHistory = useCallback((entry: Omit<HistoryEntry, "id" | "timestamp">) => {
    setHistory((items) => [{ ...entry, id: crypto.randomUUID(), timestamp: Date.now() }, ...items].slice(0, 40));
  }, []);

  const getDecks = useCallback(() => {
    const a = deckA.current;
    const b = deckB.current;
    if (!a || !b) return null;
    return activeDeck.current === "a" ? { active: a, standby: b, next: "b" as const } : { active: b, standby: a, next: "a" as const };
  }, []);

  const switchTo = useCallback(async (station: RadioStation, reason: string, first = false) => {
    if (switching.current) return false;
    const decks = getDecks();
    if (!decks) return false;
    switching.current = true;
    const operation = generation.current;
    autoplayBlocked.current = false;
    visited.current.add(station.id);
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    const { active, standby, next } = decks;
    setState(first ? "ready" : "transitioning");
    setMessage(first ? "Подключаем прямой эфир" : "Готовим плавный переход");
    standby.src = station.url;
    standby.volume = 0;
    try {
      await waitUntilReady(standby);
      if (operation !== generation.current) return false;
      await standby.play();
      if (operation !== generation.current) return false;
    } catch (error) {
      if (operation !== generation.current) return false;
      autoplayBlocked.current = error instanceof DOMException && error.name === 'NotAllowedError';
      switching.current = false;
      standby.pause();
      if (!active.paused && active.src) {
        setState('playing');
        setMessage('Новая станция недоступна — сохраняем текущий эфир');
        addHistory({type: 'system', stationName: station.name, stationId: station.id, country: station.country, detail: 'Ошибка подключения; переход не состоялся'});
        return false;
      }
      setState(error instanceof DOMException && error.name === "NotAllowedError" ? "paused" : "error");
      setMessage(error instanceof DOMException && error.name === "NotAllowedError" ? "Нажмите play — браузер ждёт вашего действия" : "Этот поток не ответил. Попробуйте другой.");
      setCurrent(station);
      activeDeck.current = next;
      addHistory({ type: "system", stationName: station.name, detail: "Автозапуск недоступен" });
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
      setMessage("Прямой эфир");
      switching.current = false;
      lastSwitch.current = Date.now();
      addHistory({type: 'station', stationName: station.name, stationId: station.id, country: station.country, streamUrl: station.url, detail: reason});
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
    setMessage("Новая станция в эфире");
    switching.current = false;
    lastSwitch.current = Date.now();
    addHistory({type: 'transition', stationName: station.name, stationId: station.id, country: station.country, streamUrl: station.url, detail: reason});
    return true;
  }, [addHistory, getDecks]);

  useEffect(() => {
    let cancelled = false;
    const audioA = deckA.current;
    const audioB = deckB.current;
    async function discover() {
      setState("searching");
      setMessage(`Ищем: ${atmosphere.tags.join(" · ")}`);
      try {
        const response = await fetch(`/api/radio?tags=${encodeURIComponent(atmosphere.tags.join(","))}`);
        const data = (await response.json()) as { stations?: RadioStation[]; error?: string; hasMore?: boolean; nextOffset?: number };
        if (!response.ok || !data.stations?.length) throw new Error(data.error || "Подходящих станций не найдено");
        if (cancelled) return;
        setStations(data.stations);
        visited.current.clear();
        for (const station of data.stations.slice(0, 5)) {
          if (cancelled) return;
          const started = await switchTo(station, `Подобрано для профиля «${atmosphere.label}»`, true);
          if (started || autoplayBlocked.current) break;
        }
        let more = data.hasMore;
        let offset = data.nextOffset;
        while (!cancelled && more && offset !== undefined) {
          const nextResponse = await fetch(`/api/radio?tags=${encodeURIComponent(atmosphere.tags.join(','))}&offset=${offset}`);
          if (!nextResponse.ok || cancelled) break;
          const page = await nextResponse.json();
          if (cancelled) break;
          setStations(items => diversify([...items, ...page.stations]));
          more = page.hasMore;
          if (page.nextOffset <= offset) break;
          offset = page.nextOffset;
        }
      } catch (error) {
        if (cancelled) return;
        setState("error");
        setMessage(error instanceof Error ? error.message : "Не удалось найти радио");
      }
    }
    void discover();
    return () => {
      cancelled = true;
      generation.current += 1;
      switching.current = false;
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
      finishFade.current?.();
      [audioA, audioB].forEach((audio) => {
        audio?.pause();
        audio?.removeAttribute("src");
      });
    };
  }, [atmosphere.key, atmosphere.label, atmosphere.tags, switchTo]);

  useEffect(() => {
    if (!current || current.id.startsWith('custom:')) return;
    let cancelled = false;
    async function readMetadata() {
      try {
        const response = await fetch(`/api/radio/metadata?stationId=${encodeURIComponent(current!.id)}`);
        const data = (await response.json()) as { streamTitle?: string | null };
        if (!cancelled && data.streamTitle) {
          setStreamTitle(data.streamTitle);
          if (data.streamTitle !== lastTitle.current) {
            lastTitle.current = data.streamTitle;
            addHistory({type: 'track', stationName: current!.name, stationId: current!.id, country: current!.country, streamTitle: data.streamTitle, detail: 'Название из метаданных эфира'});
          }
        }
      } catch {
        // Many stations do not expose ICY metadata; station-level matching remains valid.
      }
    }
    void readMetadata();
    const timer = window.setInterval(readMetadata, 45_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [current, addHistory]);

  useEffect(() => {
    if (state !== 'playing' || !current) return;
    const timer = window.setInterval(() => {
      if (switching.current || Date.now() - lastSwitch.current < 240_000) return;
      let next = nextStation(stations, current, visited.current);
      if (!next) { visited.current.clear(); next = nextStation(stations, current, visited.current); }
      if (next) void switchTo(next, 'Автоматическая ротация: подходящий жанр, приоритет другой страны');
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [state, current, stations, switchTo]);

  function togglePlayback() {
    if (switching.current) return;
    const decks = getDecks();
    if (!decks || !current) return;
    const audio = decks.active.src ? decks.active : decks.standby;
    if (audio.paused) {
      audio.volume = volume;
      void audio.play().then(() => { setState("playing"); setMessage("Прямой эфир"); }).catch(() => setState("error"));
    } else {
      audio.pause();
      setState("paused");
      setMessage("Эфир на паузе");
    }
  }

  async function rejectCurrent() {
    if (!stations.length || !current) return;
    addHistory({ type: "rejected", stationName: current.name, streamTitle: streamTitle ?? undefined, detail: "Отмечено: не подходит" });
    let next = nextStation(stations, current, visited.current);
    if (!next) { visited.current.clear(); next = nextStation(stations, current, visited.current); }
    if (next) await switchTo(next, "Другая станция по вашему сигналу");
  }

  function changeVolume(next: number) {
    setVolume(next);
    volumeRef.current = next;
    const decks = getDecks();
    if (decks) decks.active.volume = next;
  }

  const isPlaying = state === "playing" || state === "transitioning";
  const atmosphereStyle = { "--mood-a": atmosphere.colors[0], "--mood-b": atmosphere.colors[1] } as React.CSSProperties;

  return (
    <aside className={`music-panel ${collapsed ? "is-collapsed" : ""}`} style={atmosphereStyle} data-state={state} data-station-id={current?.id}>
      <audio ref={deckA} preload="none" />
      <audio ref={deckB} preload="none" />
      <div className="music-panel-head">
        <div className="panel-title"><History size={15} /><span>Music history</span></div>
        <button className="icon-button panel-toggle" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? "Открыть историю" : "Скрыть историю"}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {collapsed ? (
        <div className="collapsed-radio">
          <span className={`live-dot ${isPlaying ? "is-live" : ""}`} />
          <button className="icon-button strong" onClick={togglePlayback} aria-label={isPlaying ? "Пауза" : "Включить эфир"}>
            {isPlaying ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <Radio size={16} />
        </div>
      ) : (
        <>
          <div className="atmosphere-card">
            <div className="atmosphere-orb" />
            <span className="eyebrow">Профиль книги</span>
            <strong>{atmosphere.label}</strong>
            <p>{atmosphere.note}</p>
            <div className="tag-row">{atmosphere.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
            <p>{stations.length} станций · {new Set(stations.map(s => s.country).filter(Boolean)).size} стран</p>
          </div>

          <div className="history-list" aria-live="polite">
            <button className="diagnostics-export" onClick={() => {
              const url = URL.createObjectURL(new Blob([JSON.stringify({exportedAt: new Date().toISOString(), history, currentStation: current, candidates: stations.length}, null, 2)], {type: 'application/json'}));
              const link = document.createElement('a'); link.href = url; link.download = 'radio-session.json'; link.click(); URL.revokeObjectURL(url);
            }}>Скачать историю эфира</button>
            {history.length === 0 ? (
              <div className="history-empty"><AudioLines size={22} /><p>История появится после подключения к эфиру.</p></div>
            ) : history.map((entry) => (
              <article className={`history-item type-${entry.type}`} key={entry.id}>
                <div className="history-mark" />
                <div>
                  <time>{new Date(entry.timestamp).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}</time>
                  <strong>{entry.stationName}</strong>
                  {entry.country && <span>{entry.country}</span>}
                  {entry.streamTitle && <span>{entry.streamTitle}</span>}
                  <p>{entry.detail}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="radio-dock">
            <div className="radio-now">
              <span className={`live-dot ${isPlaying ? "is-live" : ""}`} />
              <div>
                <span className="eyebrow">{state === "transitioning" ? "Crossfade / 8 sec" : "Live signal"}</span>
                <strong>{current?.name || "Atmosphere Radio"}</strong>
                {current?.country && <span>{current.country}</span>}
                <span className="stream-title">{streamTitle || message}</span>
              </div>
              {current?.homepage && <a className="icon-button" href={current.homepage} target="_blank" rel="noreferrer" aria-label="Открыть сайт станции"><ExternalLink size={14} /></a>}
            </div>
            <div className="radio-controls">
              <button className="icon-button strong" onClick={togglePlayback} disabled={!current || state === "searching"} aria-label={isPlaying ? "Пауза" : "Включить эфир"}>
                {state === "searching" ? <RefreshCw className="spin" size={17} /> : isPlaying ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <button className="reject-button" onClick={() => void rejectCurrent()} disabled={!current || state === "searching" || state === 'transitioning'}><X size={14} />Не подходит</button>
              <label className="volume-control">
                {volume === 0 ? <VolumeX size={16} /> : volume < 0.5 ? <Volume1 size={16} /> : <Volume2 size={16} />}
                <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => changeVolume(Number(event.target.value))} aria-label="Громкость" />
              </label>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
