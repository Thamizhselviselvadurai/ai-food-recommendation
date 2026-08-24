import { clamp } from '../../utils/time.js';

/**
 * Expands a compact `crowdProfile` into a 7x24 baseline busyness matrix.
 *
 * This is OUR OWN modelled expectation of how busy a venue usually is, built
 * from the venue's own service profile and (in production) its own check-in and
 * feedback history. It is not, and does not claim to be, live occupancy data
 * from any map provider.
 *
 * profile = {
 *   base:          floor busyness when open (0..1)
 *   peaks:         [[centerHour, widthHours, amplitude], ...] centerHour may
 *                  exceed 24 to express a post-midnight peak (e.g. 24.5 = 00:30)
 *   weekendBoost:  extra amplitude on Fri/Sat/Sun (can be negative for
 *                  weekday-office venues)
 * }
 */
export function buildBaselineCurve(profile, openingHours = []) {
  const { base = 0.1, peaks = [], weekendBoost = 0.15 } = profile ?? {};

  // Fri, Sat and Sun carry the boost at different strengths; Monday is quietest.
  const dayFactor = [0.8, -0.06, -0.03, 0, 0.05, 0.6, 1.0]; // index = dayOfWeek (0 = Sun)

  const matrix = [];
  for (let day = 0; day < 7; day += 1) {
    const boost = weekendBoost * (dayFactor[day] ?? 0);
    const row = [];
    for (let hour = 0; hour < 24; hour += 1) {
      let value = base;
      for (const [center, width, amplitude] of peaks) {
        // Circular distance so a 00:30 peak still lifts 23:00.
        const raw = Math.abs(hour - center);
        const distance = Math.min(raw, 24 - raw);
        value += (amplitude + boost) * Math.exp(-(distance ** 2) / (2 * width ** 2));
      }
      row.push(Number(clamp(value, 0, 1).toFixed(4)));
    }
    matrix.push(row);
  }

  // A closed hour has no crowd, whatever the curve says.
  if (openingHours?.length) {
    for (let day = 0; day < 7; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        if (!isHourWithinOpeningHours(openingHours, day, hour)) matrix[day][hour] = 0;
      }
    }
  }

  return matrix;
}

function isHourWithinOpeningHours(openingHours, day, hour) {
  const prevDay = (day + 6) % 7;
  const parse = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h + (m || 0) / 60;
  };

  for (const w of openingHours) {
    if (w.closed) continue;
    const open = parse(w.open);
    const close = parse(w.close);
    const wraps = close <= open;

    if (w.dayOfWeek === day) {
      if (wraps ? hour >= open : hour >= open && hour < close) return true;
    }
    if (wraps && w.dayOfWeek === prevDay && hour < close) return true;
  }
  return false;
}

/** Reads the baseline for a moment in time, interpolating between hours. */
export function baselineAt(curve, date = new Date()) {
  if (!curve?.length) return 0.25;
  const day = date.getDay();
  const hour = date.getHours();
  const frac = date.getMinutes() / 60;
  const current = curve[day]?.[hour] ?? 0.2;
  const next = curve[day]?.[(hour + 1) % 24] ?? current;
  return current + (next - current) * frac;
}
