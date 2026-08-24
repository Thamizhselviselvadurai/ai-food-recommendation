const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres between two {lat, lng} points. */
export function haversineKm(a, b) {
  if (!a || !b) return null;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Mongo `$centerSphere` expects radians. */
export const kmToRadians = (km) => km / EARTH_RADIUS_KM;

export function isValidCoordinate(lat, lng) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

/**
 * Privacy: we never persist a user's exact coordinates. Anything stored
 * long-term (check-ins, analytics) is snapped to a ~1.1 km grid first.
 */
export function coarsenLocation({ lat, lng }, precision = 2) {
  const factor = 10 ** precision;
  return {
    lat: Math.round(lat * factor) / factor,
    lng: Math.round(lng * factor) / factor,
  };
}

/** Rough walking/driving ETA used for "how long until I'm eating" estimates. */
export function travelMinutes(distanceKm, mode = 'drive') {
  if (distanceKm == null) return null;
  const speedKmph = mode === 'walk' ? 4.8 : 22;
  return Math.max(1, Math.round((distanceKm / speedKmph) * 60));
}

export const formatDistance = (km) =>
  km == null ? null : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
