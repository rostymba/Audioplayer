// Общее поле обучения (рычаг C.2). Фаза 0: IndexedDB за абстракцией + in-memory фолбэк.
// Позже общий бэкенд реализует тот же интерфейс, не меняя вызывающую логику.
//
// Приватный контракт: события ОБЕЗЛИЧЕНЫ. Не храним пользователя и не храним книгу —
// только атмосферу как корзину, чтобы через общее поле не утекло, кто что читает.

export type LearningAction = 'reject' | 'skip-ad' | 'skip-talk' | 'skip-mismatch' | 'played-ok' | 'connect-fail';

export interface LearningEvent {
  stationId: string;
  streamTitle?: string;
  atmosphereKey: string; // корзина атмосферы, НЕ идентификатор книги
  action: LearningAction;
  timestamp: number;
}

// Агрегат для понижения станции в подборе (рычаг B это читает).
export interface StationSignal {
  stationId: string;
  rejects: number;
  adHits: number;
  talkHits: number;
  playedOk: number;
  /** Поток не завёлся в браузере. Самый тяжёлый сигнал: станция просто не играет. */
  connectFails: number;
}

export interface LearningStore {
  record(event: LearningEvent): Promise<void>;
  // Сигнал по станциям в рамках атмосферы; пустой ключ = по всем.
  signals(atmosphereKey?: string): Promise<StationSignal[]>;
}

class MemoryLearningStore implements LearningStore {
  private events: LearningEvent[] = [];

  async record(event: LearningEvent): Promise<void> {
    this.events.push(event);
  }

  async signals(atmosphereKey?: string): Promise<StationSignal[]> {
    const byStation = new Map<string, StationSignal>();
    for (const event of this.events) {
      if (atmosphereKey && event.atmosphereKey !== atmosphereKey) continue;
      const signal = byStation.get(event.stationId)
        ?? { stationId: event.stationId, rejects: 0, adHits: 0, talkHits: 0, playedOk: 0, connectFails: 0 };
      if (event.action === 'reject') signal.rejects += 1;
      else if (event.action === 'skip-ad') signal.adHits += 1;
      else if (event.action === 'skip-talk') signal.talkHits += 1;
      else if (event.action === 'played-ok') signal.playedOk += 1;
      else if (event.action === 'connect-fail') signal.connectFails += 1;
      byStation.set(event.stationId, signal);
    }
    return [...byStation.values()];
  }
}

const DB_NAME = 'audioplayer-learning';
const STORE = 'events';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// IndexedDB-стор: локальная реализация того же контракта. В демо «общее поле» пока
// локальное; агрегация signals() устроена так, что перенос на серверный стор не тронет вызовы.
class IndexedDbLearningStore implements LearningStore {
  async record(event: LearningEvent): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add(event);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async signals(atmosphereKey?: string): Promise<StationSignal[]> {
    const db = await openDb();
    const events = await new Promise<LearningEvent[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as LearningEvent[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const memory = new MemoryLearningStore();
    for (const event of events) await memory.record(event);
    return memory.signals(atmosphereKey);
  }
}

let store: LearningStore = typeof indexedDB !== 'undefined'
  ? new IndexedDbLearningStore()
  : new MemoryLearningStore();

export function getLearningStore(): LearningStore {
  return store;
}

export function setLearningStore(next: LearningStore): void {
  store = next;
}
