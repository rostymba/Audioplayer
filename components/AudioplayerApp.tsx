"use client";

import {
  BookOpen,
  FileUp,
  Library,
  LoaderCircle,
  Trash2,
  Upload,
} from "lucide-react";
import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { BookReader } from "./BookReader";
import { RadioPanel } from "./RadioPanel";
import { deleteBook, getBooks, putBook } from "@/lib/db";
import { importEpub } from "@/lib/epub";
import type { StoredBook } from "@/lib/types";

function formatDate(value: number) {
  return new Intl.DateTimeFormat("ru", { day: "2-digit", month: "short", year: "numeric" }).format(value);
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
  const [historyCollapsed, setHistoryCollapsed] = useState(false);

  useEffect(() => {
    void getBooks()
      .then((items) => setBooks(items.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)))
      .catch(() => setError("Не удалось открыть локальную библиотеку."))
      .finally(() => setLoadingLibrary(false));
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("audioplayer:history-collapsed");
    const timer = window.setTimeout(() => setHistoryCollapsed(stored === "true"), 0);
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() === "h" && !target?.matches("input, textarea, select")) {
        setHistoryCollapsed((value) => !value);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", onKeyDown); };
  }, []);

  function toggleHistory() {
    setHistoryCollapsed((value) => {
      localStorage.setItem("audioplayer:history-collapsed", String(!value));
      return !value;
    });
  }

  async function handleFile(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".epub")) {
      setError("Нужен файл в формате .epub");
      return;
    }
    if (file.size > 75 * 1024 * 1024) {
      setError("Для первой версии размер EPUB ограничен 75 МБ.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const imported = await importEpub(file);
      const existing = books.find((book) => book.id === imported.id);
      const book = existing ? { ...imported, progress: existing.progress, progressPercent: existing.progressPercent, createdAt: existing.createdAt } : imported;
      await putBook(book);
      setBooks((items) => [book, ...items.filter((item) => item.id !== book.id)]);
      setSelectedBook(book);
    } catch (cause) {
      console.error(cause);
      setError("Не удалось прочитать EPUB. Проверьте, что файл не повреждён.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function openBook(book: StoredBook) {
    const updated = { ...book, lastOpenedAt: timestamp() };
    setSelectedBook(updated);
    setBooks((items) => items.map((item) => item.id === updated.id ? updated : item));
    await putBook(updated);
  }

  async function removeBook(book: StoredBook) {
    if (!window.confirm(`Удалить «${book.title}» и сохранённый прогресс?`)) return;
    await deleteBook(book.id);
    setBooks((items) => items.filter((item) => item.id !== book.id));
  }

  const saveProgress = useCallback((cfi: string, progressPercent: number) => {
    setSelectedBook((current) => {
      if (!current || (current.progress === cfi && current.progressPercent === progressPercent)) return current;
      const updated = { ...current, progress: cfi, progressPercent, lastOpenedAt: timestamp() };
      setBooks((items) => items.map((item) => item.id === updated.id ? updated : item));
      void putBook(updated);
      return updated;
    });
  }, []);

  if (selectedBook) {
    return (
      <main className="app-shell reader-mode" style={{ "--mood-a": selectedBook.atmosphere.colors[0], "--mood-b": selectedBook.atmosphere.colors[1] } as React.CSSProperties}>
        <div className={`reading-workspace ${historyCollapsed ? "history-collapsed" : ""}`}>
          <RadioPanel atmosphere={selectedBook.atmosphere} collapsed={historyCollapsed} onToggle={toggleHistory} />
          <BookReader key={selectedBook.id} book={selectedBook} onProgress={saveProgress} onExit={() => setSelectedBook(null)} />
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell library-mode">
      <div className="ambient-field ambient-field-a" />
      <div className="ambient-field ambient-field-b" />

      <section className="library-content">
        <div className="library-intro">
          <span className="eyebrow">Книги в прямом эфире</span>
          <h1>Загрузите книгу.<br /><em>Мы настроим волну.</em></h1>
          <p>Локальная EPUB-читалка ищет живое радио под атмосферу текста. Без аккаунта, плейлистов и лишнего выбора.</p>
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
            aria-label="Выбрать EPUB"
            disabled={importing}
            onChange={(event: ChangeEvent<HTMLInputElement>) => void handleFile(event.target.files?.[0])}
          />
          <span className="upload-icon">{importing ? <LoaderCircle className="spin" /> : <FileUp />}</span>
          <strong>{importing ? "Читаем структуру книги…" : "Перетащите EPUB сюда"}</strong>
          <span>{importing ? "Определяем атмосферу и готовим библиотеку" : "или нажмите, чтобы выбрать файл · до 75 МБ"}</span>
          <i><Upload size={14} />Локальная загрузка</i>
        </div>

        {error && <div className="error-note"><span>!</span>{error}</div>}

        <div className="collection-head">
          <div><Library size={17} /><span>Локальная библиотека</span></div>
          <span>{String(books.length).padStart(2, "0")} книг</span>
        </div>

        {loadingLibrary ? (
          <div className="library-loading"><LoaderCircle className="spin" />Открываем картотеку…</div>
        ) : books.length === 0 ? (
          <div className="empty-library">
            <span>001</span>
            <p>Здесь появятся все загруженные книги — как карточки в личной читательской картотеке.</p>
          </div>
        ) : (
          <div className="book-grid">
            {books.map((book, index) => (
              <article className="book-card" key={book.id}>
                <button className="book-open-area" onClick={() => void openBook(book)}>
                  <div className="book-cover" style={{ "--cover-a": book.atmosphere.colors[0], "--cover-b": book.atmosphere.colors[1] } as React.CSSProperties}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- EPUB covers are local data URLs. */}
                    {book.coverDataUrl ? <img src={book.coverDataUrl} alt={`Обложка ${book.title}`} /> : <><span>{String(index + 1).padStart(3, "0")}</span><BookOpen /></>}
                    <div className="cover-grain" />
                  </div>
                  <div className="book-meta">
                    <span className="eyebrow">{book.atmosphere.label}</span>
                    <h2>{book.title}</h2>
                    <p>{book.author}</p>
                    <div className="book-progress-row"><span>{book.progressPercent}%</span><i><b style={{ width: `${book.progressPercent}%` }} /></i></div>
                    <time>Открыто {formatDate(book.lastOpenedAt)}</time>
                  </div>
                </button>
                <button className="delete-book" onClick={() => void removeBook(book)} aria-label={`Удалить ${book.title}`}><Trash2 size={15} /></button>
              </article>
            ))}
          </div>
        )}
      </section>
      <footer className="library-footer"><span>EPUB / RADIO BROWSER / LOCAL FIRST</span><span>SHANGHAI — 2026</span></footer>
    </main>
  );
}
