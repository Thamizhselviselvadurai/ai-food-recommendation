import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocation } from '../context/LocationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { ALLERGENS, CALORIE_PREFERENCES, CUISINES, DIET_TYPES, SPICE_LEVELS } from '../lib/constants.js';
import { Chip, ErrorState, Loading, SectionHeader, Toggle } from '../components/ui.jsx';
import { relativeTime, rupees, titleCase } from '../lib/format.js';

export default function Profile() {
  const { user, setPreferences } = useAuth();
  const { clear: clearLocation, hasLocation } = useLocation();
  const toast = useToast();

  const { data, loading, error, run } = useAsync(() => api.preferences(), []);
  const feedbackHistory = useAsync(() => api.recommendationHistory(), []);

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.preferences) {
      const p = data.preferences;
      setForm({
        dietType: p.dietType ?? 'nonveg',
        preferredSpiceLevel: p.preferredSpiceLevel ?? 'medium',
        maxSpiceLevel: p.maxSpiceLevel ?? 'hot',
        defaultBudget: p.defaultBudget ?? 300,
        caloriePreference: p.caloriePreference ?? 'any',
        highProtein: Boolean(p.highProtein),
        preferredCuisines: p.preferredCuisines ?? [],
        allergies: p.allergies ?? [],
        avoidIngredients: (p.avoidIngredients ?? []).join(', '),
        maxWaitMinutes: p.maxWaitMinutes ?? 45,
        maxDistanceKm: p.maxDistanceKm ?? 6,
      });
    }
  }, [data]);

  if (loading || !form) return <Loading label="Loading your preferences…" />;
  if (error) return <ErrorState error={error} onRetry={run} />;

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const toggleIn = (key, value) =>
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((v) => v !== value) : [...current[key], value],
    }));

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api.savePreferences({
        ...form,
        defaultBudget: Number(form.defaultBudget),
        maxWaitMinutes: Number(form.maxWaitMinutes),
        maxDistanceKm: Number(form.maxDistanceKm),
        avoidIngredients: form.avoidIngredients.split(',').map((v) => v.trim()).filter(Boolean),
        onboardingComplete: true,
      });
      setPreferences(response.preferences);
      toast.success('Preferences saved.');
    } catch (requestError) {
      toast.error(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const resetLearning = async () => {
    try {
      const response = await api.resetLearning();
      setPreferences(response.preferences);
      run();
      toast.success(response.message);
    } catch (requestError) {
      toast.error(requestError.message);
    }
  };

  const learned = data.preferences;
  const cuisineAffinity = Object.entries(learned.cuisineAffinity ?? {}).sort((a, b) => b[1] - a[1]);
  const tagAffinity = Object.entries(learned.tagAffinity ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <span className="text-4xl" aria-hidden="true">{user.avatarEmoji}</span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{user.name}</h1>
          <p className="text-sm muted">{user.email}</p>
        </div>
      </header>

      <form onSubmit={save} className="card space-y-6 p-5">
        <SectionHeader title="Your preferences" subtitle="These are used as defaults everywhere in the app." />

        <div className="grid gap-6 sm:grid-cols-2">
          <fieldset>
            <legend className="label">Diet</legend>
            <div className="flex flex-wrap gap-2">
              {DIET_TYPES.map((diet) => (
                <Chip key={diet.id} active={form.dietType === diet.id} onClick={() => set({ dietType: diet.id })}>
                  <span aria-hidden="true">{diet.emoji}</span> {diet.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">Preferred spice</legend>
            <div className="flex flex-wrap gap-2">
              {SPICE_LEVELS.map((spice) => (
                <Chip key={spice.id} active={form.preferredSpiceLevel === spice.id} onClick={() => set({ preferredSpiceLevel: spice.id })}>
                  {spice.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">Never hotter than</legend>
            <div className="flex flex-wrap gap-2">
              {SPICE_LEVELS.map((spice) => (
                <Chip key={spice.id} active={form.maxSpiceLevel === spice.id} onClick={() => set({ maxSpiceLevel: spice.id })}>
                  {spice.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="label" htmlFor="defaultBudget">Default budget — {rupees(form.defaultBudget)}</label>
            <input
              id="defaultBudget"
              type="range"
              min="50"
              max="1500"
              step="10"
              value={form.defaultBudget}
              onChange={(event) => set({ defaultBudget: Number(event.target.value) })}
              className="w-full accent-brand-600"
            />
          </div>

          <div>
            <label className="label" htmlFor="calories">Calorie preference</label>
            <select id="calories" className="field" value={form.caloriePreference} onChange={(event) => set({ caloriePreference: event.target.value })}>
              {CALORIE_PREFERENCES.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <div className="mt-3">
              <Toggle checked={form.highProtein} onChange={(value) => set({ highProtein: value })} label="Favour high protein" />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="maxWait">Max waiting time — {form.maxWaitMinutes} min</label>
            <input
              id="maxWait"
              type="range" min="10" max="120" step="5"
              value={form.maxWaitMinutes}
              onChange={(event) => set({ maxWaitMinutes: Number(event.target.value) })}
              className="w-full accent-brand-600"
            />
            <label className="label mt-3" htmlFor="maxDistance">Max distance — {form.maxDistanceKm} km</label>
            <input
              id="maxDistance"
              type="range" min="1" max="20" step="0.5"
              value={form.maxDistanceKm}
              onChange={(event) => set({ maxDistanceKm: Number(event.target.value) })}
              className="w-full accent-brand-600"
            />
          </div>

          <fieldset className="sm:col-span-2">
            <legend className="label">Favourite cuisines</legend>
            <div className="flex flex-wrap gap-2">
              {CUISINES.map((cuisine) => (
                <Chip key={cuisine.id} active={form.preferredCuisines.includes(cuisine.id)} onClick={() => toggleIn('preferredCuisines', cuisine.id)}>
                  {cuisine.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset className="sm:col-span-2">
            <legend className="label">Allergies</legend>
            <div className="flex flex-wrap gap-2">
              {ALLERGENS.map((allergen) => (
                <Chip key={allergen.id} active={form.allergies.includes(allergen.id)} onClick={() => toggleIn('allergies', allergen.id)}>
                  {allergen.label}
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-xs muted">
              Dishes listing a selected allergen are removed entirely. Menu allergen data can be incomplete — always
              confirm with the restaurant if your allergy is severe.
            </p>
          </fieldset>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="avoid">Ingredients to avoid</label>
            <input
              id="avoid"
              className="field"
              placeholder="e.g. mushroom, capsicum"
              value={form.avoidIngredients}
              onChange={(event) => set({ avoidIngredients: event.target.value })}
            />
          </div>
        </div>

        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
      </form>

      <section className="card p-5">
        <SectionHeader
          title="What the app has learned"
          subtitle="Built from your orders, ratings and rejected suggestions."
          action={<button type="button" className="btn-ghost text-sm text-rose-600" onClick={resetLearning}>Reset learning</button>}
        />

        {cuisineAffinity.length || tagAffinity.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide muted">Cuisines</h3>
              <ul className="space-y-1.5">
                {cuisineAffinity.map(([cuisine, score]) => (
                  <li key={cuisine} className="flex items-center gap-2 text-sm">
                    <span className="w-28 shrink-0 truncate">{titleCase(cuisine)}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.abs(score) * 100}%`,
                          marginLeft: score < 0 ? 'auto' : 0,
                          background: score >= 0 ? 'var(--viz-seq-450)' : 'var(--viz-status-critical)',
                        }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums muted">
                      {score > 0 ? '+' : ''}{Math.round(score * 100)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide muted">Flavours &amp; styles</h3>
              <div className="flex flex-wrap gap-1.5">
                {tagAffinity.map(([tag, score]) => (
                  <span
                    key={tag}
                    className="chip-idle text-xs"
                    title={`Learned weight ${score > 0 ? '+' : ''}${Math.round(score * 100)}`}
                  >
                    {score > 0 ? '👍' : '👎'} {titleCase(tag)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm muted">
            Nothing learned yet. Order something, rate a dish, or reject a recommendation and this fills in.
          </p>
        )}

        {(learned.priceSensitivity || learned.spiceDrift || learned.portionDrift) ? (
          <ul className="mt-4 space-y-1 border-t border-ink-100 pt-3 text-xs muted dark:border-ink-800">
            {Boolean(learned.priceSensitivity) && <li>Price sensitivity: {learned.priceSensitivity > 0 ? 'leaning cheaper' : 'happy to spend more'}</li>}
            {Boolean(learned.spiceDrift) && <li>Spice drift: {learned.spiceDrift > 0 ? 'suggesting hotter' : 'suggesting milder'}</li>}
            {Boolean(learned.portionDrift) && <li>Portion drift: {learned.portionDrift > 0 ? 'suggesting more filling plates' : 'suggesting lighter plates'}</li>}
          </ul>
        ) : null}
      </section>

      <section className="card p-5">
        <SectionHeader title="Recent recommendations" subtitle="Every suggestion is logged with the context that produced it." />
        {feedbackHistory.loading ? (
          <Loading label="Loading history…" />
        ) : feedbackHistory.data?.history?.length ? (
          <ul className="space-y-2">
            {feedbackHistory.data.history.slice(0, 8).map((entry) => (
              <li key={entry._id} className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 pb-2 text-sm last:border-0 dark:border-ink-800">
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {entry.query ? `“${entry.query}”` : titleCase(entry.surface)}
                  </p>
                  <p className="truncate text-xs muted">
                    {entry.results?.slice(0, 3).map((r) => r.food?.name).filter(Boolean).join(', ') || 'No results'}
                  </p>
                </div>
                <span className="shrink-0 text-xs muted">{relativeTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm muted">No recommendations yet.</p>
        )}
      </section>

      <section className="card p-5">
        <SectionHeader title="Privacy" />
        <ul className="space-y-2 text-sm muted">
          <li>• Your precise location is used only for the request that needs it and is never stored — anything we keep is rounded to roughly a kilometre.</li>
          <li>• Check-ins are stored without your identity and expire automatically.</li>
          <li>• Nutrition figures throughout the app are estimates, not measured values.</li>
          <li>• Crowd levels are this app’s own estimates from its own signals, not live data from any map provider.</li>
        </ul>
        {hasLocation && (
          <button type="button" className="btn-secondary mt-3" onClick={clearLocation}>
            Forget my cached location
          </button>
        )}
      </section>
    </div>
  );
}
