import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const LocationContext = createContext(null);
const STORAGE_KEY = 'foodai.location';

/**
 * Location handling, with privacy as the default:
 *  - never requested automatically; the user taps "Use my location"
 *  - only a coarse copy (~1 km grid) is cached in this browser
 *  - the server is told the precise point only for the request that needs it,
 *    and stores only the coarse version
 */
export function LocationProvider({ children }) {
  const [location, setLocation] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | requesting | granted | denied | unavailable
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (cached?.lat != null) {
        setLocation({ ...cached, source: 'cached' });
        setStatus('granted');
      }
    } catch {
      /* ignore unreadable cache */
    }
  }, []);

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unavailable');
      setError('This browser cannot share your location.');
      return Promise.resolve(null);
    }

    setStatus('requesting');
    setError(null);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const next = {
            lat: Number(position.coords.latitude.toFixed(5)),
            lng: Number(position.coords.longitude.toFixed(5)),
            accuracy: position.coords.accuracy,
            source: 'device',
          };
          setLocation(next);
          setStatus('granted');
          try {
            // Cache only a coarse point — enough to restore the map view.
            localStorage.setItem(
              STORAGE_KEY,
              JSON.stringify({ lat: Number(next.lat.toFixed(2)), lng: Number(next.lng.toFixed(2)) })
            );
          } catch {
            /* ignore */
          }
          resolve(next);
        },
        (positionError) => {
          setStatus(positionError.code === positionError.PERMISSION_DENIED ? 'denied' : 'unavailable');
          setError(
            positionError.code === positionError.PERMISSION_DENIED
              ? 'Location permission was declined. We will show results for the city centre instead.'
              : 'Could not read your location. We will show results for the city centre instead.'
          );
          resolve(null);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
      );
    });
  }, []);

  const clear = useCallback(() => {
    setLocation(null);
    setStatus('idle');
    setError(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ location, status, error, request, clear, hasLocation: Boolean(location) }),
    [location, status, error, request, clear]
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export const useLocation = () => {
  const context = useContext(LocationContext);
  if (!context) throw new Error('useLocation must be used inside <LocationProvider>');
  return context;
};
