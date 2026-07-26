export {};

declare global {
  type LampMode = 'ambient' | 'focus' | 'night';
  type ThemeMode = 'day' | 'night' | 'auto';

  interface DeskThemeAPI {
    get(): { mode: ThemeMode; theme: 'day' | 'night'; focus: boolean };
    set(mode: ThemeMode): void;
    toggle(): void;
    setFocus(on: boolean): void;
    setLamp(lamp: LampMode): void;
    getLamp(): LampMode;
  }

  interface WindowEventMap {
    'desk:theme': CustomEvent<{
      theme: 'day' | 'night';
      mode: ThemeMode;
      focus: boolean;
    }>;
  }

  interface Window {
    deskTheme?: DeskThemeAPI;
    /** dev/test 专用钩子（生产构建剔除） */
    __desk?: {
      test?: {
        activateHotspot?: (id: string) => void;
        completeClock?: () => void;
      };
    };
  }
}
