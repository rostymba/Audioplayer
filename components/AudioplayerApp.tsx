"use client";

import {
  BookOpen,
  LoaderCircle,
} from "lucide-react";
import Image from "next/image";
import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { BookReader } from "./BookReader";
import { RadioPanel } from "./RadioPanel";
import { deleteBook, getBooks, putBook } from "@/lib/db";
import { importEpub } from "@/lib/epub";
import { ensureRealEmbedder, isRealEmbedder } from "@/lib/embeddings";
import { matchTags } from "@/lib/atmosphere-tagging";
import { layoutLibrary } from "@/lib/library-layout";
import type { Highlight, InkNote, StoredBook } from "@/lib/types";

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(value);
}

function timestamp() {
  return Date.now();
}

export function AudioplayerApp() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [books, setBooks] = useState<StoredBook[]>([]);
  const [selectedBook, setSelectedBook] = useState<StoredBook | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refinedTags, setRefinedTags] = useState<{ bookId: string; tags: string[] } | null>(null);
  // Своё окно подтверждения вместо window.confirm — системное выпадало из стиля библиотеки.
  const [pendingDelete, setPendingDelete] = useState<StoredBook | null>(null);

  useEffect(() => {
    if (!pendingDelete) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPendingDelete(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingDelete]);

  useEffect(() => {
    // Преднагружаем локальную модель эмбеддингов заранее, чтобы к загрузке книги была готова.
    ensureRealEmbedder()?.catch(() => {});
    // Прогреваем Audio Guard заранее: иначе первый стартовый скрининг вернёт warming
    // и книга откроется без проверки эфира на рекламу.
    void fetch('/api/radio/audio-guard').catch(() => {});
  }, []);

  // Resolve one profile before starting radio. A bounded fallback prevents an unavailable
  // model from blocking playback; late results never replace an already selected profile.
  useEffect(() => {
    const book = selectedBook;
    if (!book) return;
    let cancelled = false;
    let settled = false;
    const settle = (tags: string[]) => {
      if (cancelled || settled) return;
      settled = true;
      window.clearTimeout(timeout);
      setRefinedTags({ bookId: book.id, tags });
    };
    const timeout = window.setTimeout(() => settle(book.atmosphere.tags), 12_000);
    void (async () => {
      try {
        if (!book.sample) return;
        await ensureRealEmbedder();
        if (cancelled || settled || !isRealEmbedder()) return;
        const matched = await matchTags(`${book.title}\n${book.author}\n${book.sample!}`);
        if (matched.radioTags.length) settle(matched.radioTags);
      } catch {
        // Use the local keyword profile if semantic analysis is unavailable.
      } finally {
        settle(book.atmosphere.tags);
      }
    })();
    return () => { cancelled = true; window.clearTimeout(timeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBook?.id]);

  useEffect(() => {
    void getBooks()
      // Порядок загрузки, а не последнего открытия: сетка и так меняется от прогресса,
      // и если карточки ещё и переставлять местами, библиотека перестаёт узнаваться.
      .then((items) => setBooks(items.sort((a, b) => a.createdAt - b.createdAt)))
      .catch(() => setError("Could not open the local library."))
      .finally(() => setLoadingLibrary(false));
  }, []);

  async function handleFile(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".epub")) {
      setError("Please choose a file in .epub format.");
      return;
    }
    if (file.size > 75 * 1024 * 1024) {
      setError("EPUB files are limited to 75 MB in this version.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const imported = await importEpub(file);
      const existing = books.find((book) => book.id === imported.id);
      const book = existing
        ? {
          ...imported,
          progress: existing.progress,
          progressPercent: existing.progressPercent,
          createdAt: existing.createdAt,
          highlights: existing.highlights,
          inkNotes: existing.inkNotes,
          locations: existing.locations,
        }
        : imported;
      await putBook(book);
      setBooks((items) => [book, ...items.filter((item) => item.id !== book.id)]);
      setRefinedTags(null);
      setSelectedBook(book);
    } catch (cause) {
      console.error(cause);
      setError("Could not read this EPUB. Check that the file is not damaged.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function openBook(book: StoredBook) {
    const updated = { ...book, lastOpenedAt: timestamp() };
    setRefinedTags(null);
    setSelectedBook(updated);
    setBooks((items) => items.map((item) => item.id === updated.id ? updated : item));
    await putBook(updated);
  }

  async function confirmDelete() {
    const book = pendingDelete;
    if (!book) return;
    setPendingDelete(null);
    await deleteBook(book.id);
    setBooks((items) => items.filter((item) => item.id !== book.id));
  }

  const saveHighlight = useCallback((highlight: Highlight) => {
    setSelectedBook((current) => {
      if (!current) return current;
      const updated = { ...current, highlights: [...(current.highlights ?? []), highlight] };
      setBooks((items) => items.map((item) => item.id === updated.id ? updated : item));
      void putBook(updated);
      return updated;
    });
  }, []);

  const saveInkNotes = useCallback((inkNotes: InkNote[]) => {
    setSelectedBook((current) => {
      if (!current) return current;
      const updated = { ...current, inkNotes };
      setBooks((items) => items.map((item) => item.id === updated.id ? updated : item));
      void putBook(updated);
      return updated;
    });
  }, []);

  const saveLocations = useCallback((json: string) => {
    // Карта позиций считается один раз и живёт в библиотеке: со следующего открытия
    // прогресс готов мгновенно, без повторной генерации.
    setSelectedBook((current) => {
      if (!current || current.locations === json) return current;
      const updated = { ...current, locations: json };
      setBooks((items) => items.map((item) => item.id === updated.id ? updated : item));
      void putBook(updated);
      return updated;
    });
  }, []);

  const saveProgress = useCallback((cfi: string, progressPercent: number) => {
    setSelectedBook((current) => {
      if (!current || (current.progress === cfi && current.progressPercent === progressPercent)) return current;
      const updated = { ...current, progress: cfi, progressPercent, lastOpenedAt: timestamp() };
      setBooks((items) => items.map((item) => item.id === updated.id ? updated : item));
      void putBook(updated);
      return updated;
    });
  }, []);

  // Ширины считаем разом по всей библиотеке: ряд должен закрываться без пустых ячеек.
  const layout = layoutLibrary(books.map((item) => item.progressPercent));

  if (selectedBook) {
    return (
      <main className="app-shell reader-mode" style={{ "--mood-a": selectedBook.atmosphere.colors[0], "--mood-b": selectedBook.atmosphere.colors[1] } as React.CSSProperties}>
        <div className="reading-workspace">
          <RadioPanel key={`radio:${selectedBook.id}`} bookId={selectedBook.id} bookLanguage={selectedBook.language ?? (/\p{Script=Cyrillic}/u.test(selectedBook.sample ?? '') ? 'ru' : '')} atmosphere={selectedBook.atmosphere} analysisReady={refinedTags?.bookId === selectedBook.id} refinedTags={refinedTags?.bookId === selectedBook.id ? refinedTags.tags : null} />
          <BookReader key={`reader:${selectedBook.id}`} book={selectedBook} onProgress={saveProgress} onLocations={saveLocations} onHighlight={saveHighlight} onInkNotes={saveInkNotes} onExit={() => setSelectedBook(null)} />
        </div>
      </main>
    );
  }

  return (
    <main className={`app-shell library-mode ${!loadingLibrary && books.length === 0 ? "is-empty" : ""}`}>
      <section className="library-content">
        <section className="library-hero-grid" aria-labelledby="library-title">
          <div className="library-intro">
            <span className="library-system-label">SYSTEM</span>
            <h1 id="library-title"><span>ONE BOOK.</span><span className="hero-line-shift">ONE ATMOSPHERE.</span><span className="hero-highlight">LIVE RADIO.</span></h1>
          </div>

          <div
            className={`upload-zone ${dragging ? "is-dragging" : ""}`}
            onDragOver={(event: DragEvent) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event: DragEvent) => { event.preventDefault(); setDragging(false); void handleFile(event.dataTransfer.files[0]); }}
          >
            <input
              ref={fileInputRef}
              className="upload-input"
              type="file"
              accept=".epub,application/epub+zip"
              aria-label="Choose EPUB"
              disabled={importing}
              onChange={(event: ChangeEvent<HTMLInputElement>) => void handleFile(event.target.files?.[0])}
            />
            <span className="upload-number">IMPORT</span>
            <span className="upload-icon">{importing ? <LoaderCircle className="spin" /> : <Image src="/icons/upload-brutalist.svg" width={68} height={68} alt="" />}</span>
            <strong>{importing ? "READING THE BOOK…" : "UPLOAD EPUB"}</strong>
            <span>{importing ? "Reading the atmosphere" : "Click or drop a file here · up to 75 MB"}</span>
          </div>

          <div className="library-principle">
            <span>PRINCIPLE</span>
            <p>Upload a book — its vibe and atmosphere, paired with a live radio stream for the session.</p>
          </div>

          <div className="library-counter" aria-label={`${books.length} books in the library`}>
            <span>BOOKS</span>
            <strong>{String(books.length).padStart(2, "0")}</strong>
            <small>IN YOUR ARCHIVE</small>
          </div>
        </section>

        {error && <div className="error-note"><span>!</span>{error}</div>}

        {loadingLibrary ? (
          <div className="library-loading"><LoaderCircle className="spin" />Opening the catalogue…</div>
        ) : books.length === 0 ? null : (
          <div className="book-grid">
            {books.map((book, index) => (
              <article
                className={`book-card is-depth-${layout[index].tier} ${layout[index].endsRow ? "is-row-end" : ""}`}
                style={{ "--span": layout[index].span } as React.CSSProperties}
                key={book.id}
              >
                <button className="book-open-area" onClick={() => void openBook(book)}>
                  <span className="book-catalog-number">{String(index + 1).padStart(2, "0")}</span>
                  <div className="book-cover" style={{ "--cover-a": book.atmosphere.colors[0], "--cover-b": book.atmosphere.colors[1] } as React.CSSProperties}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- EPUB covers are local data URLs. */}
                    {book.coverDataUrl ? <img src={book.coverDataUrl} alt={`Cover of ${book.title}`} /> : <><span>{String(index + 1).padStart(2, "0")}</span><BookOpen /></>}
                    <div className="cover-grain" />
                  </div>
                  <div className="book-meta">
                    <time>LAST OPEN / {formatDate(book.lastOpenedAt)}</time>
                  </div>
                </button>
                <button className="delete-book" onClick={() => setPendingDelete(book)} aria-label={`Delete ${book.title}`}><Image src="/icons/trash-brutalist.svg" width={68} height={69} alt="" /></button>
              </article>
            ))}
          </div>
        )}
      </section>
      {pendingDelete && (
        <div className="confirm-overlay" role="presentation" onClick={() => setPendingDelete(null)}>
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="confirm-title">DELETE BOOK</h2>
            <p className="confirm-body">
“{pendingDelete.title}” and reading progress will be removed from the library. This cannot be undone.
            </p>
            <div className="confirm-actions">
              <button className="confirm-cancel" onClick={() => setPendingDelete(null)} autoFocus>CANCEL</button>
              <button className="confirm-accept" onClick={() => void confirmDelete()}>DELETE</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
