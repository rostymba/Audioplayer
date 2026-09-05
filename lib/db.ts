import type { StoredBook } from "./types";

const DB_NAME = "audioplayer-local";
const STORE_NAME = "books";
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runRequest<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

export function getBooks() {
  return runRequest<StoredBook[]>("readonly", (store) => store.getAll());
}

export function putBook(book: StoredBook) {
  return runRequest<IDBValidKey>("readwrite", (store) => store.put(book));
}

export function deleteBook(id: string) {
  return runRequest<undefined>("readwrite", (store) => store.delete(id));
}
