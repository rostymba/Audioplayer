"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { Highlight, InkNote, InkPoint, InkStroke, StoredBook } from "@/lib/types";

type RenditionLike = {
  display: (target?: string) => Promise<unknown>;
  next: () => Promise<unknown>;
  prev: () => Promise<unknown>;
  destroy: () => void;
  resize?: (width: number, height: number) => void;
  on: (event: string, callback: (location: { start: { cfi: string; percentage?: number } }) => void) => void;
  getContents?: () => Array<{ document: Document }>;
  themes: {
    registerCss: (name: string, css: string) => void;
    select: (name: string) => void;
    override: (name: string, value: string, priority?: boolean) => void;
    font: (family: string) => void;
    fontSize: (size: string) => void;
  };
};

type EpubBookLike = {
  renderTo: (element: HTMLElement, options: object) => RenditionLike;
  destroy: () => void;
  locations: {
    generate: (chars: number) => Promise<unknown>;
    percentageFromCfi: (cfi: string) => number;
    load: (json: string) => void;
    save: () => string;
  };
};

// Иконки рисуем маской, а не <img>: тогда цвет глифа берётся из currentColor
// и на ховере он честно уходит в акцентный оранжевый.
function glyph(name: string) {
  return { "--glyph": `url(/icons/${name}.svg)` } as CSSProperties;
}

// Служебные разделы в начале книги: обложка, титул, копирайт, оглавление, посвящение.
// Открываться на них не нужно — читателю сразу нужен текст.
const FRONT_MATTER = /(cover|titlepage|title-page|halftitle|half-title|copyright|colophon|imprint|^toc|[^a-z]toc|contents|^nav|[^a-z]nav|dedicat|acknowledg|epigraph|frontmatter|front-matter|annotation|praise|bookinfo|about-?(the-?)?author)/i;
const CHAPTER_MIN_CHARS = 900;
const FALLBACK_MIN_CHARS = 300;
const MAX_SECTIONS_SCANNED = 16;

type SpineSection = {
  href?: string;
  idref?: string;
  linear?: string;
  load: (request: unknown) => Promise<unknown>;
  unload: () => void;
};

type EpubContents = {
  range: (cfiRange: string) => Range | null;
  document: Document;
  window?: Window | null;
};

type SelectionView = {
  on: (event: "selected", callback: (cfiRange: string, contents: EpubContents) => void) => void;
  annotations: {
    highlight: (
      cfiRange: string,
      data?: object,
      callback?: () => void,
      className?: string,
      styles?: Record<string, string>,
    ) => void;
    remove: (cfiRange: string, type: "highlight") => void;
  };
};

type SpineView = {
  ready: Promise<unknown>;
  load: (path: string) => Promise<unknown>;
  spine?: { spineItems?: SpineSection[] };
};

function textOf(node: unknown): string {
  const candidate = node as { documentElement?: { textContent?: string | null } | null; textContent?: string | null } | null;
  if (!candidate) return "";
  const raw = candidate.documentElement?.textContent ?? candidate.textContent ?? "";
  return raw.replace(/\s+/g, " ").trim();
}

// Идём по spine и берём первый раздел с настоящим объёмом текста: по имени файла отсеиваем
// служебные страницы, по длине — короткие врезки вроде эпиграфа или благодарностей.
async function findFirstChapter(view: SpineView): Promise<string | undefined> {
  try {
    await view.ready;
  } catch {
    return undefined;
  }
  const items = view.spine?.spineItems ?? [];
  let fallback: string | undefined;
  for (const item of items.slice(0, MAX_SECTIONS_SCANNED)) {
    if (item.linear === "no" || !item.href) continue;
    let text = "";
    try {
      text = textOf(await item.load(view.load.bind(view)));
    } catch {
      continue;
    } finally {
      try { item.unload(); } catch { /* раздел мог не успеть загрузиться */ }
    }
    if (!text) continue;
    if (!fallback && text.length >= FALLBACK_MIN_CHARS) fallback = item.href;
    if (FRONT_MATTER.test(item.href) || FRONT_MATTER.test(item.idref ?? "")) continue;
    if (text.length < CHAPTER_MIN_CHARS) continue;
    return item.href;
  }
  return fallback;
}

const HIGHLIGHT_COLOR = "#ff4d2e";
const HIGHLIGHT_OPACITY = "0.32";
const HIGHLIGHT_FILL = "rgba(255, 77, 46, .32)";
const INK_COLORS = ["#ff4d2e", "#242322"] as const;
const INK_WIDTHS = [3, 5, 8] as const;

type InkColor = typeof INK_COLORS[number];
type InkWidth = typeof INK_WIDTHS[number];

/**
 * Кнопка «в закладки» живёт только в полях, слева от выделения — на текст она не заезжает.
 * Свободны ровно две вертикальные полосы: левое поле разворота и просвет между колонками.
 * Колонку определяем по экранным координатам страницы: внутренняя ширина iframe у epub.js
 * равна всему проскроллированному полотну, и по ней колонка считалась неверно.
 */
function gutterX(doc: Document, page: DOMRect, selectionLeft: number): number {
  const body = getComputedStyle(doc.body);
  const padding = parseFloat(body.paddingLeft) || 0;
  const gap = parseFloat(body.columnGap) || parseFloat(getComputedStyle(doc.documentElement).columnGap) || 0;
  const columnWidth = Math.max(0, (page.width - padding * 2 - gap) / 2);

  const secondColumn = selectionLeft >= page.left + page.width / 2;
  const columnStart = secondColumn ? page.left + padding + columnWidth : page.left;
  const textLeft = secondColumn ? columnStart + gap : page.left + padding;

  const wanted = textLeft - TEXT_CLEARANCE - BUTTON_SIZE / 2;
  return Math.max(columnStart + BUTTON_SIZE / 2, wanted);
}

function makeHighlight(cfiRange: string, text: string): Highlight {
  const now = Date.now();
  return { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, cfiRange, text, createdAt: now };
}

function makeInkStroke(points: InkPoint[], color: InkColor, width: InkWidth): InkStroke {
  const now = Date.now();
  return { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, points, color, width, createdAt: now };
}

function strokePath(points: InkPoint[]) {
  if (!points.length) return "";
  const scaled = points.map((point) => ({ x: point.x * 100, y: point.y * 100 }));
  if (scaled.length === 1) return `M ${scaled[0].x} ${scaled[0].y}`;
  let path = `M ${scaled[0].x} ${scaled[0].y}`;
  for (let index = 1; index < scaled.length - 1; index += 1) {
    const point = scaled[index];
    const next = scaled[index + 1];
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }
  const last = scaled[scaled.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

/** Зазор между кнопкой и первой буквой выделенной колонки. */
const TEXT_CLEARANCE = 16;
const BUTTON_SIZE = 36;
const BUTTON_CLEARANCE = 8;

/**
 * Кнопка не должна попадать на стрелки листания: если её прямоугольник пересекается
 * со стрелкой, сдвигаем по вертикали в ближайшую свободную сторону.
 */
function dodgeArrows(wrap: HTMLElement, wrapRect: DOMRect, x: number, y: number): number {
  let result = y;
  for (const arrow of wrap.querySelectorAll<HTMLElement>(".page-turn")) {
    const box = arrow.getBoundingClientRect();
    const left = box.left - wrapRect.left;
    const top = box.top - wrapRect.top;
    const overlapsX = x + BUTTON_SIZE / 2 > left - BUTTON_CLEARANCE && x - BUTTON_SIZE / 2 < left + box.width + BUTTON_CLEARANCE;
    const overlapsY = result + BUTTON_SIZE > top - BUTTON_CLEARANCE && result < top + box.height + BUTTON_CLEARANCE;
    if (!overlapsX || !overlapsY) continue;
    const above = top - BUTTON_CLEARANCE - BUTTON_SIZE;
    const below = top + box.height + BUTTON_CLEARANCE;
    result = Math.abs(result - above) <= Math.abs(result - below) && above >= 0 ? above : below;
  }
  return result;
}

const READER_LINE_HEIGHT = 1.72;
const BASE_FONT_PX = 16;
const READER_GUTTER = 24;
const READER_SETTINGS_KEY = "audioplayer.readerSettings.v1";
const READER_FONTS = [
  { label: "Literata", value: "Literata", css: "Literata, Georgia, 'Times New Roman', serif" },
  { label: "Golos", value: "Golos", css: "'Golos Text', system-ui, sans-serif" },
  { label: "Bitter", value: "Bitter", css: "Bitter, Georgia, 'Times New Roman', serif" },
  { label: "IBM Plex Mono", value: "IBM Plex Mono", css: "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace" },
] as const;

type ReaderFont = typeof READER_FONTS[number]["value"];

type ReaderSettings = {
  fontSize: number;
  columns: 1 | 2;
  singleColumnWidth: number;
  doubleColumnWidth: number;
  font: ReaderFont;
};

const COLUMN_WIDTH_LIMITS = {
  1: { min: 560, max: 1360, step: 20, fallback: 800 },
  2: { min: 360, max: 760, step: 20, fallback: 640 },
} as const;

type ColumnWidthLimits = typeof COLUMN_WIDTH_LIMITS[keyof typeof COLUMN_WIDTH_LIMITS];

const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: 100,
  columns: 2,
  singleColumnWidth: COLUMN_WIDTH_LIMITS[1].fallback,
  doubleColumnWidth: COLUMN_WIDTH_LIMITS[2].fallback,
  font: "Literata",
};

function clampStep(value: unknown, fallback: number, min: number, max: number, step: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(number / step) * step));
}

function normalizeReaderSettings(raw: unknown, fallback = DEFAULT_READER_SETTINGS): ReaderSettings {
  const source = raw && typeof raw === "object" ? raw as Partial<ReaderSettings> & { columnWidth?: number; margin?: number } : {};
  const font = READER_FONTS.some((item) => item.value === source.font) ? source.font as ReaderFont : fallback.font;
  const legacyWidth = typeof source.margin === "number" ? 760 - source.margin * 20 : source.columnWidth;
  return {
    fontSize: clampStep(source.fontSize, fallback.fontSize, 80, 140, 10),
    columns: source.columns === 1 || source.columns === 2 ? source.columns : fallback.columns,
    singleColumnWidth: clampStep(source.singleColumnWidth, legacyWidth ?? fallback.singleColumnWidth, COLUMN_WIDTH_LIMITS[1].min, COLUMN_WIDTH_LIMITS[1].max, COLUMN_WIDTH_LIMITS[1].step),
    doubleColumnWidth: clampStep(source.doubleColumnWidth, legacyWidth ?? fallback.doubleColumnWidth, COLUMN_WIDTH_LIMITS[2].min, COLUMN_WIDTH_LIMITS[2].max, COLUMN_WIDTH_LIMITS[2].step),
    font,
  };
}

function responsiveReaderSettingsFallback(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULT_READER_SETTINGS;
  return { ...DEFAULT_READER_SETTINGS, columns: window.matchMedia("(max-width: 720px)").matches ? 1 : 2 };
}

function readerSettingsStorageKey(bookId: string) {
  return `${READER_SETTINGS_KEY}:${encodeURIComponent(bookId)}`;
}

function readReaderSettings(key: string, fallback: ReaderSettings) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? normalizeReaderSettings(JSON.parse(value), fallback) : null;
  } catch {
    return null;
  }
}

function initialReaderSettings(bookId: string): ReaderSettings {
  const fallback = responsiveReaderSettingsFallback();
  if (typeof window === "undefined") return fallback;
  return readReaderSettings(readerSettingsStorageKey(bookId), fallback)
    ?? readReaderSettings(READER_SETTINGS_KEY, fallback)
    ?? fallback;
}

function fontCss(font: ReaderFont) {
  return READER_FONTS.find((item) => item.value === font)?.css ?? READER_FONTS[0].css;
}

function activeColumnWidth(settings: ReaderSettings) {
  return settings.columns === 1 ? settings.singleColumnWidth : settings.doubleColumnWidth;
}

function columnWidthToPercent(width: number, limits: ColumnWidthLimits) {
  return Math.round(((width - limits.min) / (limits.max - limits.min)) * 100);
}

function percentToColumnWidth(percent: number, limits: ColumnWidthLimits) {
  const safePercent = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  return limits.min + (limits.max - limits.min) * (safePercent / 100);
}

function readerThemeCss() {
  return `
@font-face { font-family: 'Literata'; font-style: normal; font-weight: 400; src: url('/fonts/reader/literata-cyrillic-400-normal.woff2') format('woff2'); unicode-range: U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
@font-face { font-family: 'Literata'; font-style: normal; font-weight: 400; src: url('/fonts/reader/literata-latin-400-normal.woff2') format('woff2'); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
@font-face { font-family: 'Golos Text'; font-style: normal; font-weight: 400; src: url('/fonts/reader/golos-text-cyrillic-400-normal.woff2') format('woff2'); unicode-range: U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
@font-face { font-family: 'Golos Text'; font-style: normal; font-weight: 400; src: url('/fonts/reader/golos-text-latin-400-normal.woff2') format('woff2'); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
@font-face { font-family: 'Bitter'; font-style: normal; font-weight: 400; src: url('/fonts/reader/bitter-cyrillic-400-normal.woff2') format('woff2'); unicode-range: U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
@font-face { font-family: 'Bitter'; font-style: normal; font-weight: 400; src: url('/fonts/reader/bitter-latin-400-normal.woff2') format('woff2'); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
@font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 400; src: url('/fonts/reader/ibm-plex-mono-cyrillic-400-normal.woff2') format('woff2'); unicode-range: U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
@font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 400; src: url('/fonts/reader/ibm-plex-mono-latin-400-normal.woff2') format('woff2'); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
html, body { background: transparent !important; }
body {
  color: #242322 !important;
  background: transparent !important;
  line-height: ${READER_LINE_HEIGHT} !important;
  padding: 0 !important;
}
::selection { background: ${HIGHLIGHT_FILL} !important; }
p, li { font-size: 1em !important; }
a { color: #285fe8 !important; }
`;
}

function applyReaderPadding(rendition: RenditionLike) {
  rendition.themes.override("padding-top", "0", true);
  rendition.themes.override("padding-bottom", "0", true);
  rendition.themes.override("padding-left", "0", true);
  rendition.themes.override("padding-right", "0", true);
}

function applyReaderBaseTheme(rendition: RenditionLike) {
  rendition.themes.registerCss("paper", readerThemeCss());
  rendition.themes.select("paper");
  applyReaderPadding(rendition);
}

function applyReaderFont(rendition: RenditionLike, font: ReaderFont) {
  rendition.themes.override("font-family", fontCss(font), true);
  rendition.themes.font(fontCss(font));
}

function applyReaderFontSize(rendition: RenditionLike, fontSize: number) {
  rendition.themes.override("font-size", `${fontSize}%`, true);
  rendition.themes.fontSize(`${fontSize}%`);
}

function applyReaderSettings(rendition: RenditionLike, settings: ReaderSettings) {
  applyReaderBaseTheme(rendition);
  applyReaderFont(rendition, settings.font);
  applyReaderFontSize(rendition, settings.fontSize);
}

async function waitForReaderFonts(rendition: RenditionLike) {
  const contents = rendition.getContents?.() ?? [];
  await Promise.all(contents.map((content) => content.document.fonts?.ready.catch(() => undefined)));
}

export function BookReader({ book, onProgress, onLocations, onHighlight, onInkNotes, onExit }: { book: StoredBook; onProgress: (cfi: string, percent: number) => void; onLocations: (json: string) => void; onHighlight: (highlight: Highlight) => void; onInkNotes: (inkNotes: InkNote[]) => void; onExit: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<RenditionLike | null>(null);
  const pendingHighlight = useRef<((cfiRange: string) => void) | null>(null);
  // Документ книги, в котором живёт текущее выделение: после сохранения его надо снять,
  // иначе поверх закреплённой подсветки остаётся ещё и системное выделение.
  const selectionOwner = useRef<EpubContents | null>(null);
  const initialProgressRef = useRef(book.progress);
  const initialPercentRef = useRef(book.progressPercent);
  const cachedLocationsRef = useRef(book.locations);
  const savedHighlightsRef = useRef(book.highlights);
  const currentHighlightsRef = useRef(book.highlights ?? []);
  const currentInkNotesRef = useRef(book.inkNotes ?? []);
  const currentCfiRef = useRef(book.progress);
  const currentProgressPercentRef = useRef(book.progressPercent);
  const layoutRefreshIdRef = useRef(0);
  const drawingPointerIdRef = useRef<number | null>(null);
  const activeStrokeRef = useRef<InkStroke | null>(null);
  // Колбэк держим в ref: он меняется на каждый рендер, а книгу перемонтировать нельзя.
  const highlightCallbackRef = useRef(onHighlight);
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(() => initialReaderSettings(book.id));
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inkMode, setInkMode] = useState(false);
  const [inkColor, setInkColor] = useState<InkColor>(INK_COLORS[0]);
  const [inkWidth, setInkWidth] = useState<InkWidth>(INK_WIDTHS[1]);
  const [inkNotes, setInkNotes] = useState<InkNote[]>(book.inkNotes ?? []);
  const [activeStroke, setActiveStroke] = useState<InkStroke | null>(null);
  const [adjustingLayout, setAdjustingLayout] = useState(false);
  // Кнопка «в закладки» рядом с выделением: координаты считаем относительно области страницы.
  const [pendingSelection, setPendingSelection] = useState<{ cfiRange: string; text: string; x: number; y: number } | null>(null);
  const readerSettingsRef = useRef(readerSettings);
  const { fontSize, columns, font } = readerSettings;
  const columnWidth = activeColumnWidth(readerSettings);
  const activeColumnLimits = COLUMN_WIDTH_LIMITS[columns];
  const columnWidthPercent = columnWidthToPercent(columnWidth, activeColumnLimits);
  const mountStyle = {
    "--reader-workspace-width": columns === 2 ? `${columnWidth * 2 + 64}px` : `${columnWidth}px`,
  } as CSSProperties;
  const [visibleCfi, setVisibleCfi] = useState(book.progress ?? "");
  const visibleInkNotes = inkNotes.filter((note) => note.anchorCfi === visibleCfi);
  const visibleInkStrokeCount = visibleInkNotes.reduce((total, note) => total + note.strokes.length, 0);

  function clearNativeSelection() {
    const owner = selectionOwner.current;
    if (!owner) return;
    try {
      (owner.window ?? owner.document.defaultView)?.getSelection()?.removeAllRanges();
    } catch { /* выделение могло уже исчезнуть вместе со страницей */ }
    selectionOwner.current = null;
  }

  function pointFromInkEvent(event: ReactPointerEvent<HTMLDivElement>): InkPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      pressure: event.pressure || undefined,
    };
  }

  function commitInkNotes(next: InkNote[]) {
    currentInkNotesRef.current = next;
    setInkNotes(next);
    onInkNotes(next);
  }

  function commitInkStroke(stroke: InkStroke) {
    if (stroke.points.length < 2) return;
    const anchorCfi = visibleCfi || currentCfiRef.current;
    if (!anchorCfi) return;
    const now = Date.now();
    const existing = currentInkNotesRef.current.find((note) => note.anchorCfi === anchorCfi);
    const note = existing
      ? { ...existing, columns, progressPercent: currentProgressPercentRef.current, strokes: [...existing.strokes, stroke], updatedAt: now }
      : { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, anchorCfi, progressPercent: currentProgressPercentRef.current, columns, strokes: [stroke], createdAt: now, updatedAt: now };
    const next = existing
      ? currentInkNotesRef.current.map((item) => item.id === note.id ? note : item)
      : [...currentInkNotesRef.current, note];
    commitInkNotes(next);
  }

  function beginInkStroke(event: ReactPointerEvent<HTMLDivElement>) {
    if (!inkMode || loading) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingPointerIdRef.current = event.pointerId;
    const stroke = makeInkStroke([pointFromInkEvent(event)], inkColor, inkWidth);
    activeStrokeRef.current = stroke;
    setActiveStroke(stroke);
  }

  function moveInkStroke(event: ReactPointerEvent<HTMLDivElement>) {
    if (drawingPointerIdRef.current !== event.pointerId || !activeStrokeRef.current) return;
    event.preventDefault();
    const point = pointFromInkEvent(event);
    const previous = activeStrokeRef.current.points.at(-1);
    if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 0.002) return;
    const stroke = { ...activeStrokeRef.current, points: [...activeStrokeRef.current.points, point] };
    activeStrokeRef.current = stroke;
    setActiveStroke(stroke);
  }

  function finishInkStroke(event: ReactPointerEvent<HTMLDivElement>) {
    if (drawingPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* pointer мог уже завершиться */ }
    drawingPointerIdRef.current = null;
    const stroke = activeStrokeRef.current;
    activeStrokeRef.current = null;
    setActiveStroke(null);
    if (stroke) commitInkStroke(stroke);
  }

  function undoInkStroke() {
    const anchorCfi = visibleCfi || currentCfiRef.current;
    if (!anchorCfi) return;
    const note = [...currentInkNotesRef.current].reverse().find((item) => item.anchorCfi === anchorCfi && item.strokes.length);
    if (!note) return;
    const strokes = note.strokes.slice(0, -1);
    const next = strokes.length
      ? currentInkNotesRef.current.map((item) => item.id === note.id ? { ...note, strokes, updatedAt: Date.now() } : item)
      : currentInkNotesRef.current.filter((item) => item.id !== note.id);
    commitInkNotes(next);
  }

  function clearInkPage() {
    const anchorCfi = visibleCfi || currentCfiRef.current;
    if (!anchorCfi) return;
    commitInkNotes(currentInkNotesRef.current.filter((note) => note.anchorCfi !== anchorCfi));
  }

  function scheduleReaderRefresh(rendition: RenditionLike, { waitForFonts = false } = {}) {
    const refreshId = ++layoutRefreshIdRef.current;
    const target = currentCfiRef.current;
    return window.setTimeout(() => {
      void rendition.display(target).then(async () => {
        if (waitForFonts) await waitForReaderFonts(rendition);
        const freshTarget = currentCfiRef.current || target;
        if (freshTarget) await rendition.display(freshTarget);
        if (refreshId !== layoutRefreshIdRef.current) return;
        const selectionView = rendition as unknown as SelectionView;
        for (const highlight of currentHighlightsRef.current) {
          try { selectionView.annotations.remove(highlight.cfiRange, "highlight"); } catch { /* могла исчезнуть при redisplay */ }
          pendingHighlight.current?.(highlight.cfiRange);
        }
        setAdjustingLayout(false);
      }).catch(() => {
        if (refreshId === layoutRefreshIdRef.current) setAdjustingLayout(false);
      });
    }, 140);
  }

  useEffect(() => { highlightCallbackRef.current = onHighlight; }, [onHighlight]);

  useEffect(() => {
    readerSettingsRef.current = readerSettings;
    window.localStorage.setItem(readerSettingsStorageKey(book.id), JSON.stringify(readerSettings));
  }, [book.id, readerSettings]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  useEffect(() => {
    if (!inkMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInkMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inkMode]);

  // epub.js рисует ровно столько строк, сколько влезает целиком: остаток высоты
  // превращается в пустоту снизу и поля перестают быть симметричными.
  // Поэтому подгоняем высоту колонки под целое число строк.
  useEffect(() => {
    const node = mountRef.current;
    const wrap = node?.parentElement;
    if (!node || !wrap) return;
    const apply = () => {
      const available = wrap.clientHeight - READER_GUTTER * 2;
      if (available <= 0) return;
      const line = BASE_FONT_PX * (fontSize / 100) * READER_LINE_HEIGHT;
      const rows = Math.max(1, Math.floor(available / line));
      const height = Math.round(rows * line);
      if (node.style.height === `${height}px`) return;
      node.style.height = `${height}px`;
      renditionRef.current?.resize?.(node.clientWidth, height);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [fontSize, loading]);

  useEffect(() => { currentHighlightsRef.current = book.highlights ?? currentHighlightsRef.current; }, [book.highlights]);

  useEffect(() => {
    const next = book.inkNotes ?? [];
    currentInkNotesRef.current = next;
  }, [book.inkNotes]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    setPendingSelection(null);
    clearNativeSelection();
    applyReaderFont(rendition, font);
    applyReaderPadding(rendition);
    if (mountRef.current) rendition.resize?.(mountRef.current.clientWidth, mountRef.current.clientHeight);
    const refresh = scheduleReaderRefresh(rendition, { waitForFonts: true });
    return () => window.clearTimeout(refresh);
  }, [font]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    setPendingSelection(null);
    clearNativeSelection();
    applyReaderFontSize(rendition, fontSize);
    applyReaderPadding(rendition);
    if (mountRef.current) rendition.resize?.(mountRef.current.clientWidth, mountRef.current.clientHeight);
    const refresh = scheduleReaderRefresh(rendition);
    return () => window.clearTimeout(refresh);
  }, [fontSize, columnWidth]);

  useEffect(() => {
    let disposed = false;
    let rendition: RenditionLike | undefined;
    let epubBook: EpubBookLike | undefined;
    // epub.js отдаёт location.start.percentage только после генерации locations.
    // Без неё прогресс всегда 0 — именно поэтому квадратики внизу не заполнялись.
    let locationsReady = false;
    let lastCfi = initialProgressRef.current ?? '';

    const percentFor = (cfi: string, fallback?: number) => {
      const active = epubBook;
      if (locationsReady && active && cfi) {
        const value = active.locations.percentageFromCfi(cfi);
        if (Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value * 100)));
      }
      return Math.max(0, Math.min(100, Math.round((fallback ?? 0) * 100)));
    };

    async function mount() {
      if (!mountRef.current) return;
      setLoading(true);
      const { default: ePub } = await import("epubjs");
      const buffer = await book.file.arrayBuffer();
      if (disposed || !mountRef.current) return;
      const loadedBook = ePub(buffer) as unknown as EpubBookLike;
      epubBook = loadedBook;
      rendition = loadedBook.renderTo(mountRef.current, {
        width: "100%",
        height: "100%",
        spread: columns === 1 ? "none" : "always",
        flow: "paginated",
        allowScriptedContent: false,
      });
      renditionRef.current = rendition;
      // Карта позиций из кэша — тогда прогресс точен с первого кадра, без ожидания генерации.
      if (cachedLocationsRef.current) {
        try { loadedBook.locations.load(cachedLocationsRef.current); locationsReady = true; } catch { locationsReady = false; }
      }
      applyReaderSettings(rendition, readerSettingsRef.current);

      const selectionView = rendition as unknown as SelectionView;
      const paintHighlight = (cfiRange: string) => {
        try {
          selectionView.annotations.highlight(cfiRange, {}, undefined, "reader-highlight", {
            fill: HIGHLIGHT_COLOR,
            "fill-opacity": HIGHLIGHT_OPACITY,
          });
        } catch { /* подсветка не должна ронять чтение */ }
      };

      selectionView.on("selected", (cfiRange, contents) => {
        // contents.range() спотыкается на диапазонах, задевающих уже существующие подсветки,
        // поэтому живое выделение окна — надёжный запасной вариант.
        let range: Range | null = null;
        try { range = contents.range(cfiRange); } catch { range = null; }
        if (!range) {
          const live = (contents.window ?? contents.document.defaultView)?.getSelection();
          range = live && live.rangeCount && !live.isCollapsed ? live.getRangeAt(0) : null;
        }
        const text = range?.toString().trim() ?? "";
        selectionOwner.current = contents;
        const wrap = mountRef.current?.parentElement;
        if (!range || !text || !wrap) return;
        // frameElement недоступен, когда iframe в песочнице без allow-scripts,
        // поэтому берём сам элемент из точки монтирования.
        const frame = mountRef.current?.querySelector("iframe");
        if (!frame) return;
        const rect = range.getBoundingClientRect().height
          ? range.getBoundingClientRect()
          : range.getClientRects()[0];
        if (!rect) return;
        const frameRect = frame.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();
        const pageRect = mountRef.current?.getBoundingClientRect();
        if (!pageRect) return;
        const x = gutterX(contents.document, pageRect, frameRect.left + rect.left) - wrapRect.left;
        const y = frameRect.top - wrapRect.top + rect.top;
        setPendingSelection({ cfiRange, text, x, y: dodgeArrows(wrap, wrapRect, x, y) });
        // Новый клик по тексту снимает выделение — прячем кнопку вместе с ним.
        contents.document.addEventListener("mousedown", () => setPendingSelection(null), { once: true });
      });

      pendingHighlight.current = paintHighlight;
      rendition.on("relocated", (location) => {
        lastCfi = location.start.cfi;
        currentCfiRef.current = location.start.cfi;
        // Пока карта позиций не готова, посчитать процент честно нельзя. Раньше сюда уходил 0
        // и затирал сохранённый прогресс — квадратики обнулялись при каждом входе.
        const percent = locationsReady
          ? percentFor(location.start.cfi, location.start.percentage)
          : initialPercentRef.current;
        currentProgressPercentRef.current = percent;
        setVisibleCfi(location.start.cfi);
        onProgress(location.start.cfi, percent);
      });
      // Без сохранённого прогресса открываемся не на обложке, а на первой главе.
      const saved = currentCfiRef.current;
      const start = saved || await findFirstChapter(loadedBook as unknown as SpineView);
      if (disposed) return;
      if (start) {
        currentCfiRef.current = start;
        setVisibleCfi(start);
      }
      await rendition.display(start);
      if (!disposed) setLoading(false);
      // Сохранённые выделения возвращаем на страницу.
      for (const saved of savedHighlightsRef.current ?? []) pendingHighlight.current?.(saved.cfiRange);

      // Карта есть в кэше — генерировать нечего. Иначе считаем её один раз в фоне и сохраняем,
      // чтобы при следующем открытии прогресс был готов мгновенно.
      if (!locationsReady) {
        void loadedBook.locations.generate(1600).then(() => {
          if (disposed) return;
          locationsReady = true;
          if (lastCfi) onProgress(lastCfi, percentFor(lastCfi));
          try { onLocations(loadedBook.locations.save()); } catch { /* кэш опционален */ }
        }).catch(() => {
          // Без карты позиций остаёмся на грубой оценке epub.js — читать это не мешает.
        });
      }
    }

    void mount();
    return () => {
      disposed = true;
      renditionRef.current = null;
      rendition?.destroy();
      epubBook?.destroy();
    };
  }, [book.id, book.file, onProgress, onLocations, columns]);

  function keepSelection() {
    const selection = pendingSelection;
    if (!selection) return;
    setPendingSelection(null);
    clearNativeSelection();
    pendingHighlight.current?.(selection.cfiRange);
    const highlight = makeHighlight(selection.cfiRange, selection.text);
    currentHighlightsRef.current = [...currentHighlightsRef.current, highlight];
    highlightCallbackRef.current(highlight);
  }

  function updateReaderSettings(update: Partial<ReaderSettings>) {
    setReaderSettings((current) => normalizeReaderSettings({ ...current, ...update }, current));
  }

  function changeFontSize(value: number) {
    const next = clampStep(value, fontSize, 80, 140, 10);
    if (next === fontSize) return;
    setAdjustingLayout(true);
    updateReaderSettings({ fontSize: next });
  }

  function changeColumnWidthPercent(value: number) {
    const next = clampStep(percentToColumnWidth(value, activeColumnLimits), columnWidth, activeColumnLimits.min, activeColumnLimits.max, activeColumnLimits.step);
    if (next === columnWidth) return;
    setAdjustingLayout(true);
    updateReaderSettings(columns === 1 ? { singleColumnWidth: next } : { doubleColumnWidth: next });
  }

  function changeColumns(nextColumns: 1 | 2) {
    if (nextColumns === columns) return;
    setAdjustingLayout(true);
    updateReaderSettings({ columns: nextColumns });
  }

  function changeReaderFont(nextFont: ReaderFont) {
    if (nextFont === font) return;
    setAdjustingLayout(true);
    updateReaderSettings({ font: nextFont });
  }

  function toggleInkMode() {
    const next = !inkMode;
    setInkMode(next);
    if (!next) return;
    setSettingsOpen(false);
    setPendingSelection(null);
    clearNativeSelection();
  }

  return (
    <section className="reader-surface" aria-label={`Book ${book.title}`}>
      <header className="reader-toolbar">
        <div className="reader-heading">
          <button className="icon-button reader-back-button" onClick={onExit} aria-label="Back to library"><span className="icon-glyph" style={glyph("chevron-brutalist")} /></button>
        </div>
        <div className="reader-tools" aria-label="Reading settings">
          <button className={`icon-button reader-ink-button ${inkMode ? "is-active" : ""}`} onClick={toggleInkMode} aria-label="Handwritten notes" aria-pressed={inkMode}><span className="pen-glyph">✎</span></button>
          <button className="icon-button reader-settings-button" onClick={() => setSettingsOpen((open) => !open)} aria-label="Reader settings" aria-expanded={settingsOpen} aria-controls="reader-settings-popover"><span className="icon-glyph" style={glyph("gear-brutalist")} /></button>
        </div>
      </header>
      {settingsOpen && (
        <div className="reader-settings-overlay" role="presentation" onClick={() => setSettingsOpen(false)}>
          <aside
            id="reader-settings-popover"
            className="reader-settings-popover"
            role="dialog"
            aria-modal="false"
            aria-label="Reader settings"
            onClick={(event) => event.stopPropagation()}
          >
            <label className="setting-range">
              <span>TEXT</span>
              <strong>{readerSettings.fontSize}%</strong>
              <input type="range" min="80" max="140" step="10" value={readerSettings.fontSize} onChange={(event) => changeFontSize(Number(event.target.value))} />
            </label>

            <div className="setting-group">
              <span>COLUMNS</span>
              <div className="segmented-control" role="group" aria-label="Column count">
                {[1, 2].map((columns) => (
                  <button key={columns} className={readerSettings.columns === columns ? "is-active" : ""} onClick={() => changeColumns(columns as 1 | 2)}>
                    {columns}
                  </button>
                ))}
              </div>
            </div>

            <label className="setting-range">
              <span>WIDTH</span>
              <strong>{columnWidthPercent}%</strong>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={columnWidthPercent}
                onChange={(event) => changeColumnWidthPercent(Number(event.target.value))}
              />
            </label>

            <div className="setting-group">
              <span>FONT</span>
              <div className="font-choice-list" role="group" aria-label="Reader font">
                {READER_FONTS.map((font) => (
                  <button
                    key={font.value}
                    className={readerSettings.font === font.value ? "is-active" : ""}
                    style={{ fontFamily: font.css }}
                    onClick={() => changeReaderFont(font.value)}
                  >
                    {font.label}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
      <div className={`reader-page-wrap ${adjustingLayout ? "is-adjusting-layout" : ""} ${inkMode ? "is-ink-mode" : ""}`}>
        {loading && <div className="reader-loading"><span />PREPARING PAGES…</div>}
        <div ref={mountRef} className="epub-mount" style={mountStyle} />
        <button className="page-turn page-turn-left" onClick={() => void renditionRef.current?.prev()} aria-label="Previous page"><span className="icon-glyph" style={glyph("arrow-brutalist")} /></button>
        <div
          className={`ink-layer ${inkMode ? "is-drawing" : ""}`}
          onPointerDown={beginInkStroke}
          onPointerMove={moveInkStroke}
          onPointerUp={finishInkStroke}
          onPointerCancel={finishInkStroke}
          aria-hidden={!inkMode}
        >
          <svg className="ink-canvas" viewBox="0 0 100 100" preserveAspectRatio="none">
            {visibleInkNotes.flatMap((note) => note.strokes.map((stroke) => (
              <path
                key={`${note.id}:${stroke.id}`}
                d={strokePath(stroke.points)}
                stroke={stroke.color}
                strokeWidth={stroke.width}
                vectorEffect="non-scaling-stroke"
              />
            )))}
            {activeStroke && (
              <path
                d={strokePath(activeStroke.points)}
                stroke={activeStroke.color}
                strokeWidth={activeStroke.width}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        </div>
        {inkMode && (
          <div className="ink-toolbar" role="toolbar" aria-label="Handwritten note tools">
            <div className="ink-tool-group" aria-label="Ink color">
              {INK_COLORS.map((color) => (
                <button
                  key={color}
                  className={`ink-color-button ${inkColor === color ? "is-active" : ""}`}
                  style={{ "--ink-note-color": color } as CSSProperties}
                  onClick={() => setInkColor(color)}
                  aria-label={`Ink color ${color}`}
                />
              ))}
            </div>
            <div className="ink-tool-group is-width" aria-label="Ink width">
              {INK_WIDTHS.map((width) => (
                <button key={width} className={`ink-width-button ${inkWidth === width ? "is-active" : ""}`} onClick={() => setInkWidth(width)} aria-label={`Ink width ${width}`}>
                  <i style={{ width: `${width + 5}px`, height: `${width + 5}px` }} />
                </button>
              ))}
            </div>
            <button className="ink-icon-button" onClick={undoInkStroke} disabled={!visibleInkStrokeCount} aria-label="Undo last handwritten mark">
              <span className="icon-glyph" style={glyph("undo-brutalist")} />
            </button>
            <button className="ink-icon-button" onClick={clearInkPage} disabled={!visibleInkStrokeCount} aria-label="Clear handwritten marks on this page">
              <span className="icon-glyph" style={glyph("trash-brutalist")} />
            </button>
            <button className="ink-text-button is-strong" onClick={() => setInkMode(false)}>DONE</button>
          </div>
        )}
        {pendingSelection && !inkMode && (
          <button
            className="icon-button highlight-button"
            style={{ left: `${pendingSelection.x}px`, top: `${pendingSelection.y}px` }}
            onClick={keepSelection}
            aria-label="Save selection to bookmarks"
          >
            <span className="icon-glyph" style={glyph("bookmark-brutalist")} />
          </button>
        )}
        <button className="page-turn page-turn-right" onClick={() => void renditionRef.current?.next()} aria-label="Next page"><span className="icon-glyph" style={glyph("arrow-brutalist")} /></button>
      </div>
      <footer className="reader-footer">
        <div className="reading-progress" aria-label={`Reading progress: ${book.progressPercent}%`}>
          {Array.from({ length: 20 }, (_, index) => <i className={index < Math.round(book.progressPercent * 0.20) ? "is-complete" : ""} key={index} />)}
        </div>
      </footer>
    </section>
  );
}
