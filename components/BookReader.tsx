"use client";

import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StoredBook } from "@/lib/types";

type RenditionLike = {
  display: (target?: string) => Promise<unknown>;
  next: () => Promise<unknown>;
  prev: () => Promise<unknown>;
  destroy: () => void;
  on: (event: string, callback: (location: { start: { cfi: string; percentage?: number } }) => void) => void;
  themes: {
    register: (name: string, rules: Record<string, Record<string, string>>) => void;
    select: (name: string) => void;
    fontSize: (size: string) => void;
  };
};

export function BookReader({ book, onProgress }: { book: StoredBook; onProgress: (cfi: string, percent: number) => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<RenditionLike | null>(null);
  const initialProgressRef = useRef(book.progress);
  const [fontSize, setFontSize] = useState(100);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let rendition: RenditionLike | undefined;
    let epubBook: { renderTo: (element: HTMLElement, options: object) => RenditionLike; destroy: () => void } | undefined;

    async function mount() {
      if (!mountRef.current) return;
      setLoading(true);
      const { default: ePub } = await import("epubjs");
      const buffer = await book.file.arrayBuffer();
      if (disposed || !mountRef.current) return;
      epubBook = ePub(buffer);
      rendition = epubBook.renderTo(mountRef.current, {
        width: "100%",
        height: "100%",
        spread: "none",
        flow: "paginated",
        allowScriptedContent: false,
      });
      renditionRef.current = rendition;
      rendition.themes.register("paper", {
        body: {
          color: "#242322 !important",
          background: "#fbf8f1 !important",
          "font-family": "Georgia, 'Times New Roman', serif !important",
          "line-height": "1.72 !important",
          padding: "0 4% !important",
        },
        "p, li": { "font-size": "1em !important" },
        "a": { color: "#285fe8 !important" },
      });
      rendition.themes.select("paper");
      rendition.on("relocated", (location) => {
        onProgress(location.start.cfi, Math.round((location.start.percentage ?? 0) * 100));
      });
      await rendition.display(initialProgressRef.current);
      if (!disposed) setLoading(false);
    }

    void mount();
    return () => {
      disposed = true;
      renditionRef.current = null;
      rendition?.destroy();
      epubBook?.destroy();
    };
  }, [book.id, book.file, onProgress]);

  function changeFont(delta: number) {
    const next = Math.min(140, Math.max(80, fontSize + delta));
    setFontSize(next);
    renditionRef.current?.themes.fontSize(`${next}%`);
  }

  return (
    <section className="reader-surface" aria-label={`Книга ${book.title}`}>
      <header className="reader-toolbar">
        <div className="reader-title-block">
          <span className="eyebrow">Сейчас читается</span>
          <strong>{book.title}</strong>
          <span>{book.author}</span>
        </div>
        <div className="reader-tools" aria-label="Настройки чтения">
          <button className="icon-button" onClick={() => changeFont(-10)} aria-label="Уменьшить текст"><Minus size={16} /></button>
          <span className="font-value">{fontSize}%</span>
          <button className="icon-button" onClick={() => changeFont(10)} aria-label="Увеличить текст"><Plus size={16} /></button>
        </div>
      </header>
      <div className="reader-page-wrap">
        {loading && <div className="reader-loading"><span />Подготавливаем страницы…</div>}
        <div ref={mountRef} className="epub-mount" />
        <button className="page-turn page-turn-left" onClick={() => void renditionRef.current?.prev()} aria-label="Предыдущая страница"><ChevronLeft /></button>
        <button className="page-turn page-turn-right" onClick={() => void renditionRef.current?.next()} aria-label="Следующая страница"><ChevronRight /></button>
      </div>
      <footer className="reader-footer">
        <span>{String(book.progressPercent).padStart(2, "0")}%</span>
        <div className="reading-progress"><span style={{ width: `${book.progressPercent}%` }} /></div>
        <span>EPUB</span>
      </footer>
    </section>
  );
}
