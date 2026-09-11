const memoryCache = new Map<string, { data: any; expiry: number }>();
const CACHE_PREFIX = 'apicache_';
const DEFAULT_TTL = 60_000;

function isStorageAvailable(): boolean {
  try {
    const k = '__test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch { return false; }
}

function getLocalCache(key: string): { data: any; expiry: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function setLocalCache(key: string, entry: { data: any; expiry: number }): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch { /* storage full – ignore */ }
}

function removeLocalCache(key: string): void {
  try { localStorage.removeItem(CACHE_PREFIX + key); } catch {}
}

function getFromCache(key: string): { data: any; expiry: number } | null {
  const mem = memoryCache.get(key);
  if (mem) return mem;
  if (isStorageAvailable()) {
    const local = getLocalCache(key);
    if (local) {
      memoryCache.set(key, local);
      return local;
    }
  }
  return null;
}

function setInCache(key: string, entry: { data: any; expiry: number }): void {
  memoryCache.set(key, entry);
  if (isStorageAvailable()) setLocalCache(key, entry);
}

export function clearCache(pattern?: string): void {
  if (!pattern) {
    memoryCache.clear();
    if (isStorageAvailable()) {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
      keys.forEach(k => localStorage.removeItem(k));
    }
    return;
  }
  const regex = new RegExp(pattern);
  for (const key of memoryCache.keys()) {
    if (regex.test(key)) {
      memoryCache.delete(key);
      removeLocalCache(key);
    }
  }
}

export async function cachedFetch(
  url: string,
  options?: RequestInit & { ttl?: number; skipCache?: boolean }
): Promise<any> {
  const ttl = options?.ttl ?? DEFAULT_TTL;
  const skipCache = options?.skipCache ?? false;

  if (!skipCache) {
    const cached = getFromCache(url);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }
  }

  // Ensure Authorization header is attached for /api/ requests
  const fetchOptions: RequestInit = { ...options };
  if (typeof url === 'string' && url.startsWith('/api/')) {
    try {
      const stored = localStorage.getItem('sitemonitor_user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u?.access_token) {
          const h = new Headers(fetchOptions.headers);
          if (!h.has('Authorization')) {
            h.set('Authorization', `Bearer ${u.access_token}`);
          }
          fetchOptions.headers = h;
        }
      }
    } catch { /* proceed without token */ }
  }

  const res = await fetch(url, fetchOptions);
  if (!res.ok) throw new Error(`cachedFetch: ${res.status} ${res.statusText}`);
  const data = await res.json();

  if (ttl > 0) {
    setInCache(url, { data, expiry: Date.now() + ttl });
  }

  return data;
}

export async function authFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const fetchOptions: RequestInit = { ...options };
  if (typeof url === 'string' && url.startsWith('/api/')) {
    try {
      const stored = localStorage.getItem('sitemonitor_user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u?.access_token) {
          const h = new Headers(fetchOptions.headers);
          if (!h.has('Authorization')) {
            h.set('Authorization', `Bearer ${u.access_token}`);
          }
          fetchOptions.headers = h;
        }
      }
    } catch { /* proceed without token */ }
  }
  return fetch(url, fetchOptions);
}

export function getCacheAge(url: string): number | null {
  const cached = getFromCache(url);
  if (!cached) return null;
  return Date.now() - (cached.expiry - DEFAULT_TTL);
}
