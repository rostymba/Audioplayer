import { analyzeAtmosphere } from "./atmosphere";
import type { StoredBook } from "./types";

type SpineItem = {
  load: (loader: (path: string) => Promise<unknown>) => Promise<unknown>;
  unload: () => void;
  document?: Document;
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fileHash(buffer: ArrayBuffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Extracts safe display metadata and a lightweight atmosphere sample from a local EPUB. */
export async function importEpub(file: File): Promise<StoredBook> {
  const buffer = await file.arrayBuffer();
  const [{ default: ePub }, id] = await Promise.all([import("epubjs"), fileHash(buffer)]);
  const book = ePub(buffer);

  try {
    const metadata = await book.loaded.metadata;
    let coverDataUrl: string | undefined;
    try {
      const coverUrl = await book.coverUrl();
      if (coverUrl) coverDataUrl = await blobToDataUrl(await fetch(coverUrl).then((response) => response.blob()));
    } catch {
      coverDataUrl = undefined;
    }

    const samples: string[] = [];
    const spineItems = (book.spine as unknown as { spineItems: SpineItem[] }).spineItems.slice(0, 12);
    for (const item of spineItems) {
      if (samples.join(" ").length > 80_000) break;
      try {
        await item.load(book.load.bind(book));
        const text = item.document?.body?.textContent?.replace(/\s+/g, " ").trim();
        if (text) samples.push(text.slice(0, 12_000));
      } finally {
        item.unload();
      }
    }

    const title = metadata.title?.trim() || file.name.replace(/\.epub$/i, "");
    const author = metadata.creator?.trim() || "Автор не указан";
    return {
      id,
      title,
      author,
      coverDataUrl,
      file,
      fileName: file.name,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      progressPercent: 0,
      status: "ready",
      atmosphere: analyzeAtmosphere(samples.join(" "), title),
    };
  } finally {
    book.destroy();
  }
}
