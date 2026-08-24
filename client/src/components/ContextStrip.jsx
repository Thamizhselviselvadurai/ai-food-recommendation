import { useLocation } from '../context/LocationContext.jsx';
import { titleCase } from '../lib/format.js';

const WEATHER_EMOJI = { hot: '🥵', warm: '☀️', mild: '🌤️', cool: '🌥️', cold: '🧊', rainy: '🌧️' };
const MEAL_EMOJI = { breakfast: '🌅', lunch: '🍽️', snack: '☕', dinner: '🌆', late_night: '🌙' };

function Cell({ icon, label, value, title }) {
  return (
    <div className="flex min-w-0 items-center gap-2" title={title}>
      <span className="text-lg" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wide muted">{label}</div>
        <div className="truncate text-sm font-bold text-ink-900 dark:text-ink-50">{value}</div>
      </div>
    </div>
  );
}

/** The "current context" strip: where you are, what it's like out, what meal this is. */
export function ContextStrip({ context, loading }) {
  const { request, status } = useLocation();

  if (loading) {
    return <div className="skeleton h-20 w-full" />;
  }
  if (!context) return null;

  const weather = context.weather;

  return (
    <section className="card p-4" aria-label="Your current context">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Cell
          icon="📍"
          label="Location"
          value={context.usingApproxLocation ? 'City centre' : 'Your area'}
          title={
            context.usingApproxLocation
              ? 'Using a default city centre because location was not shared.'
              : 'Used for this request only. We never store your exact coordinates.'
          }
        />
        <Cell
          icon={weather ? WEATHER_EMOJI[weather.condition] ?? '🌤️' : '🌡️'}
          label="Weather"
          value={weather ? `${weather.temperatureC}° ${titleCase(weather.condition)}` : 'Not available'}
          title={weather ? `From ${weather.provider}` : 'Weather signal is unavailable or switched off.'}
        />
        <Cell
          icon={MEAL_EMOJI[context.mealSlot ?? context.time?.mealSlot] ?? '🍴'}
          label="Right now"
          value={titleCase(context.mealSlot ?? context.time?.mealSlot ?? 'meal')}
        />
        <Cell
          icon="💰"
          label="Your budget"
          value={context.budget ? `Up to ₹${context.budget}` : 'Not set'}
          title="Set a default budget in your profile."
        />
      </div>

      {context.weatherNote && (
        <p className="mt-3 border-t border-ink-100 pt-3 text-xs muted dark:border-ink-800">{context.weatherNote}</p>
      )}

      {context.usingApproxLocation && status !== 'requesting' && (
        <button type="button" onClick={request} className="mt-2 text-xs font-bold text-brand-700 hover:underline dark:text-brand-400">
          Use my exact location for better nearby results →
        </button>
      )}
    </section>
  );
}
