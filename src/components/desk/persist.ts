import type { NightSnap } from "./types";

const NIGHT_SNAP = "piplup-desk-night";

let memoryNight: NightSnap | null = null;

function readStore(): string | null {
  try {
    return localStorage.getItem(NIGHT_SNAP) ?? sessionStorage.getItem(NIGHT_SNAP);
  } catch {
    return null;
  }
}

export function loadNight(): NightSnap | null {
  if (memoryNight) return memoryNight;
  try {
    const raw = readStore();
    memoryNight = raw ? (JSON.parse(raw) as NightSnap) : null;
    return memoryNight;
  } catch {
    return null;
  }
}

export function saveNight(snap: NightSnap) {
  memoryNight = snap;
  const raw = JSON.stringify(snap);
  try {
    localStorage.setItem(NIGHT_SNAP, raw);
  } catch {
    try {
      sessionStorage.setItem(NIGHT_SNAP, raw);
    } catch {
      /* quota */
    }
  }
}

export function clearNight() {
  memoryNight = null;
  try {
    localStorage.removeItem(NIGHT_SNAP);
    sessionStorage.removeItem(NIGHT_SNAP);
  } catch {
    /* private mode */
  }
}
