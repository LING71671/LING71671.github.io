/**
 * 本地存储统一读写：desk.v1.* 键。
 * 全部 try/catch 包裹，坏数据回落默认值。
 * 注意：持久化仅用于偏好（主题/音频/画质等），绝不用于跳过入口流程。
 */

export const KEYS = {
  theme: 'desk.v1.theme',
  focusMode: 'desk.v1.focusMode',
  audio: 'desk.v1.audio',
  quality: 'desk.v1.quality',
  visited: 'desk.v1.visited',
  /** 本会话时钟已完成（sessionStorage） */
  clockDone: 'desk.session.clockDone',
  /** 本会话最后聚焦的热点（sessionStorage） */
  lastHotspot: 'desk.session.lastHotspot',
} as const;

function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(store: Storage, key: string, value: string): void {
  try {
    store.setItem(key, value);
  } catch {
    /* 隐私模式等场景静默失败 */
  }
}

function safeRemove(store: Storage, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const local = {
  get: (key: string) => safeGet(localStorage, key),
  set: (key: string, value: string) => safeSet(localStorage, key, value),
  remove: (key: string) => safeRemove(localStorage, key),
};

export const session = {
  get: (key: string) => safeGet(sessionStorage, key),
  set: (key: string, value: string) => safeSet(sessionStorage, key, value),
  remove: (key: string) => safeRemove(sessionStorage, key),
};

export type QualityTier = 'low' | 'mid' | 'high';

export function getStoredQuality(): QualityTier | null {
  const raw = local.get(KEYS.quality);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { tier?: string; ts?: number };
    const age = Date.now() - (parsed.ts ?? 0);
    const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
    if (age > SEVEN_DAYS) return null;
    if (parsed.tier === 'low' || parsed.tier === 'mid' || parsed.tier === 'high') {
      return parsed.tier;
    }
  } catch {
    /* 坏数据 */
  }
  return null;
}

export function storeQuality(tier: QualityTier): void {
  local.set(KEYS.quality, JSON.stringify({ tier, ts: Date.now() }));
}

export function isMuted(): boolean {
  // 默认静音（'0' 或未设置都视为关闭环境音）
  return local.get(KEYS.audio) !== '1';
}

export function setMutedStored(muted: boolean): void {
  local.set(KEYS.audio, muted ? '0' : '1');
}

export function isClockDoneThisSession(): boolean {
  return session.get(KEYS.clockDone) === '1';
}

export function markClockDone(): void {
  session.set(KEYS.clockDone, '1');
}

export function clearClockDone(): void {
  session.remove(KEYS.clockDone);
}
