import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Async data hook with the three states every screen needs: loading, error and
 * data. Cancels in-flight requests on unmount so a slow response never sets
 * state on a dead component.
 */
export function useAsync(fn, deps = [], { immediate = true } = {}) {
  const [state, setState] = useState({ data: null, loading: immediate, error: null });
  const mounted = useRef(true);
  const callbackRef = useRef(fn);
  callbackRef.current = fn;

  /**
   * Sequence number of the most recent call. Filters are usually changed faster
   * than requests come back, and a slow earlier request must not overwrite a
   * newer result — that is how the search page ended up showing counts for the
   * whole country after the located request had already returned local ones.
   */
  const latestRun = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async (...args) => {
    const runId = ++latestRun.current;
    const isStale = () => !mounted.current || runId !== latestRun.current;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await callbackRef.current(...args);
      if (isStale()) return data;
      setState({ data, loading: false, error: null });
      return data;
    } catch (error) {
      if (error.name === 'AbortError') return null;
      if (isStale()) return null;
      setState({ data: null, loading: false, error });
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (immediate) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, run, setData: (data) => setState((s) => ({ ...s, data })) };
}

/** Debounces a fast-changing value (search boxes, sliders). */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** localStorage-backed state that degrades to in-memory when storage is blocked. */
export function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore — state still works for this session */
    }
  }, [key, value]);

  return [value, setValue];
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const listener = (event) => setMatches(event.matches);
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, [query]);
  return matches;
}
