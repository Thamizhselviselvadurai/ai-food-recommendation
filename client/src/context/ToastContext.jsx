import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { cx } from '../lib/format.js';

const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((current) => current.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (message, { tone = 'info', duration = 4000 } = {}) => {
      const id = nextId++;
      setToasts((current) => [...current, { id, message, tone }]);
      if (duration) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      push,
      success: (message, options) => push(message, { ...options, tone: 'success' }),
      error: (message, options) => push(message, { ...options, tone: 'error', duration: 6000 }),
      info: push,
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className={cx(
              'pointer-events-auto max-w-md animate-fade-up rounded-xl px-4 py-3 text-left text-sm font-medium shadow-lg ring-1 backdrop-blur',
              toast.tone === 'success' && 'bg-emerald-600/95 text-white ring-emerald-500',
              toast.tone === 'error' && 'bg-rose-600/95 text-white ring-rose-500',
              toast.tone === 'info' && 'bg-ink-900/95 text-white ring-ink-700'
            )}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
};
