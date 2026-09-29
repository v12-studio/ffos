// Last-known copies of what the app needs to open and record entries without a connection
// (who you are, your books, each book's categories). Written after every successful load,
// read only as a fallback, and wiped on sign-out.

const PREFIX = 'ffos.snapshot.';

export function saveSnapshot(key: string, data: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(data));
  } catch {
    // Storage full or unavailable: the app just can't open offline.
  }
}

export function loadSnapshot<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function clearSnapshots() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
