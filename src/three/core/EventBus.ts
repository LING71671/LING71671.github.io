import type { HotspotId } from '../../lib/hotspots';

/** 3D 场景对外与对内共用的类型化事件 */
export interface DeskEvents {
  'assets:progress': { loaded: number; total: number };
  'scene:ready': void;
  /** 校准接近度（分钟差），驱动渐亮与刻度高亮 */
  'clock:progress': { minutesOff: number };
  'clock:hint': { kind: 'almost' | 'look-minute' };
  'clock:success': void;
  /** 入口流程完成，进入主场景 */
  'entry:complete': void;
  'hotspot:hover': {
    id: HotspotId | null;
    label?: string;
    hint?: string;
    x: number;
    y: number;
  };
  'hotspot:click': { id: HotspotId };
  /** 相机聚焦完成；anchorRect 为聚焦物体的屏幕包围盒（面板展开起点） */
  'camera:focusComplete': { id: HotspotId; anchorRect: DOMRectReadOnly };
  'camera:unfocusComplete': void;
  'lamp:modeChange': { mode: LampMode };
  'ambient:info': { text: string; x: number; y: number };
  contextlost: void;
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof DeskEvents, Set<Handler<never>>>();

  on<K extends keyof DeskEvents>(event: K, handler: Handler<DeskEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof DeskEvents>(
    event: K,
    ...args: DeskEvents[K] extends void ? [] : [DeskEvents[K]]
  ): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as Handler<DeskEvents[K] | undefined>)(args[0]);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
