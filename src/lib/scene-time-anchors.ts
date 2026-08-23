/**
 * The authored visual timeline shared by the live renderer and the full-screen
 * loading posters. Endpoints repeat `night` so local time wraps without a cut.
 */
export const SCENE_TIME_MINUTES = {
  midnight: 0,
  predawn: 300,
  dawn: 390,
  sunrise: 440,
  morning: 480,
  noon: 750,
  afternoon: 1020,
  sunset: 1110,
  bluehour: 1230,
  night: 1320,
  end: 1440,
} as const;

export const SCENE_TIME_ANCHORS = [
  { minute: SCENE_TIME_MINUTES.midnight, moment: 'night' },
  { minute: SCENE_TIME_MINUTES.predawn, moment: 'predawn' },
  { minute: SCENE_TIME_MINUTES.dawn, moment: 'dawn' },
  { minute: SCENE_TIME_MINUTES.sunrise, moment: 'sunrise' },
  { minute: SCENE_TIME_MINUTES.morning, moment: 'morning' },
  { minute: SCENE_TIME_MINUTES.noon, moment: 'noon' },
  { minute: SCENE_TIME_MINUTES.afternoon, moment: 'afternoon' },
  { minute: SCENE_TIME_MINUTES.sunset, moment: 'sunset' },
  { minute: SCENE_TIME_MINUTES.bluehour, moment: 'bluehour' },
  { minute: SCENE_TIME_MINUTES.night, moment: 'night' },
  { minute: SCENE_TIME_MINUTES.end, moment: 'night' },
] as const;

export type SceneTimeMoment = (typeof SCENE_TIME_ANCHORS)[number]['moment'];
