import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation as useRouterLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { cx } from '../lib/format.js';

const NAV = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/decide', label: 'Decide', icon: '🍽️' },
  { to: '/ask', label: 'Ask AI', icon: '💬' },
  { to: '/near-me', label: 'Near me', icon: '📍' },
  { to: '/search', label: 'Search', icon: '🔎' },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('foodai.theme', dark ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, [dark]);

  return [dark, setDark];
}

export function Layout() {
  const { user, isAuthenticated, logout } = useAuth();
  const { totals } = useCart();
  const [dark, setDark] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const routerLocation = useRouterLocation();

  // Close the account menu whenever the route changes.
  useEffect(() => setMenuOpen(false), [routerLocation.pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-ink-200/80 bg-white/85 backdrop-blur-md dark:border-ink-800 dark:bg-ink-950/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="flex shrink-0 items-center gap-2 font-extrabold tracking-tight">
            <span className="text-2xl" aria-hidden="true">🍜</span>
            <span className="hidden text-lg sm:block">
              Food<span className="text-brand-600">AI</span>
            </span>
          </Link>

          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((entry) => (
              <NavLink
                key={entry.to}
                to={entry.to}
                end={entry.end}
                className={({ isActive }) =>
                  cx(
                    'rounded-lg px-3 py-2 text-sm font-semibold transition',
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                      : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'
                  )
                }
              >
                <span className="mr-1.5" aria-hidden="true">{entry.icon}</span>
                {entry.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setDark(!dark)}
              className="btn-ghost px-2.5 py-2"
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              <span aria-hidden="true">{dark ? '☀️' : '🌙'}</span>
            </button>

            <Link to="/cart" className="btn-ghost relative px-2.5 py-2" aria-label={`Cart, ${totals.count} items`}>
              <span aria-hidden="true">🛒</span>
              {totals.count > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                  {totals.count}
                </span>
              )}
            </Link>

            {isAuthenticated ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  className="btn-ghost px-2.5 py-2"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                >
                  <span aria-hidden="true">{user.avatarEmoji ?? '🙂'}</span>
                  <span className="hidden text-sm sm:inline">{user.name.split(' ')[0]}</span>
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full mt-1 w-48 animate-scale-in overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-lg dark:border-ink-700 dark:bg-ink-900"
                  >
                    <Link role="menuitem" to="/profile" className="block px-4 py-2.5 text-sm hover:bg-ink-50 dark:hover:bg-ink-800">
                      Profile &amp; preferences
                    </Link>
                    <Link role="menuitem" to="/orders" className="block px-4 py-2.5 text-sm hover:bg-ink-50 dark:hover:bg-ink-800">
                      My orders
                    </Link>
                    <button
                      role="menuitem"
                      type="button"
                      onClick={logout}
                      className="block w-full px-4 py-2.5 text-left text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link to="/login" className="btn-primary px-3 py-2">Sign in</Link>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 md:pb-12">
        <Outlet />
      </main>

      <footer className="hidden border-t border-ink-200 py-6 text-center text-xs muted md:block dark:border-ink-800">
        Food AI · Recommendations are estimates based on your stated preferences, not health or medical advice.
        Crowd levels are this app’s own estimates, not live data from any map provider.
      </footer>

      {/* Mobile tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 backdrop-blur-md md:hidden dark:border-ink-800 dark:bg-ink-950/95"
        aria-label="Main"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-lg">
          {NAV.map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              end={entry.end}
              className={({ isActive }) =>
                cx(
                  'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold transition',
                  isActive ? 'text-brand-600 dark:text-brand-400' : 'text-ink-500 dark:text-ink-400'
                )
              }
            >
              <span className="text-lg" aria-hidden="true">{entry.icon}</span>
              {entry.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
