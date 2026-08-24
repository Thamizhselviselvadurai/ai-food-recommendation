export const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Minutes since midnight for a "HH:MM" string. */
export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function nowParts(date = new Date()) {
  return {
    date,
    dayOfWeek: date.getDay(),
    dayName: DAY_NAMES[date.getDay()],
    hour: date.getHours(),
    minutes: date.getHours() * 60 + date.getMinutes(),
    isWeekend: [0, 6].includes(date.getDay()),
  };
}

/**
 * Meal window for the current clock time. Drives "what fits right now"
 * scoring (nobody wants a heavy biryani at 7am).
 */
export function mealSlot(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 16) return 'lunch';
  if (h >= 16 && h < 19) return 'snack';
  if (h >= 19 && h < 23) return 'dinner';
  return 'late_night';
}

/** Handles windows that wrap past midnight (e.g. 18:00 -> 02:00). */
export function isOpenAt(hours, date = new Date()) {
  if (!hours || !hours.length) return true;
  const { dayOfWeek, minutes } = nowParts(date);
  const prevDay = (dayOfWeek + 6) % 7;

  const windowsFor = (day) => hours.filter((h) => h.dayOfWeek === day && !h.closed);

  for (const w of windowsFor(dayOfWeek)) {
    const open = toMinutes(w.open);
    const close = toMinutes(w.close);
    if (close > open ? minutes >= open && minutes < close : minutes >= open) return true;
  }
  for (const w of windowsFor(prevDay)) {
    const open = toMinutes(w.open);
    const close = toMinutes(w.close);
    if (close <= open && minutes < close) return true; // spilled over midnight
  }
  return false;
}

export function closingSoon(hours, date = new Date(), thresholdMin = 30) {
  if (!hours?.length) return false;
  const { dayOfWeek, minutes } = nowParts(date);
  return hours
    .filter((h) => h.dayOfWeek === dayOfWeek && !h.closed)
    .some((w) => {
      const close = toMinutes(w.close);
      const open = toMinutes(w.open);
      if (close <= open) return false;
      return minutes < close && close - minutes <= thresholdMin;
    });
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
