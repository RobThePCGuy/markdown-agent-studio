import type { LongTermMemory } from '../types/memory';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface MemoryDB {
  getAll(): Promise<LongTermMemory[]>;
  put(entry: LongTermMemory): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// InMemoryMemoryDB - Map-based, for tests and SSR
// ---------------------------------------------------------------------------

export class InMemoryMemoryDB implements MemoryDB {
  private store = new Map<string, LongTermMemory>();

  async getAll(): Promise<LongTermMemory[]> {
    return [...this.store.values()];
  }

  async put(entry: LongTermMemory): Promise<void> {
    this.store.set(entry.id, { ...entry });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// IndexedDBMemoryDB - production IndexedDB adapter
// ---------------------------------------------------------------------------

export class IndexedDBMemoryDB implements MemoryDB {
  private dbName: string;
  private storeName = 'memories';

  constructor(dbName = 'mas-long-term-memory') {
    this.dbName = dbName;
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll(): Promise<LongTermMemory[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        db.close();
        resolve(request.result as LongTermMemory[]);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }

  async put(entry: LongTermMemory): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.put(entry);

      request.onsuccess = () => {
        db.close();
        resolve();
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.delete(id);

      request.onsuccess = () => {
        db.close();
        resolve();
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }

  async clear(): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => {
        db.close();
        resolve();
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMemoryDB(): MemoryDB {
  if (typeof indexedDB !== 'undefined') {
    return new IndexedDBMemoryDB();
  }
  return new InMemoryMemoryDB();
}
