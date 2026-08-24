import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useLocation } from '../context/LocationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  ALLERGENS, CALORIE_PREFERENCES, CUISINES, DIET_TYPES, HUNGER_LEVELS, MOODS, PRICE_CATEGORIES, SPICE_LEVELS,
} from '../lib/constants.js';
import { RecommendationCard } from '../components/RecommendationCard.jsx';
import { FeedbackModal } from '../components/FeedbackModal.jsx';
import { Chip, EmptyState, ErrorState, Loading, Modal, SectionHeader, Toggle } from '../components/ui.jsx';
import { cx } from '../lib/format.js';

const DEFAULT_FORM = {
  mood: null,
  hungerLevel: 'moderate',
  budget: 250,
  priceCategory: null,
  dietType: null,
  spiceLevel: 'medium',
  cuisines: [],
  caloriePreference: 'any',
  highProtein: false,
  allergies: [],
  avoid: '',
  maxWaitMinutes: 45,
  fulfilment: 'any',
};

export default function Decide() {
  const { location } = useLocation();
  const { preferences } = useAuth();
  const { add } = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const resultsRef = useRef(null);

  const [form, setForm] = useState(() => ({
    ...DEFAULT_FORM,
    dietType: preferences?.dietType ?? null,
    budget: preferences?.defaultBudget ?? DEFAULT_FORM.budget,
    spiceLevel: preferences?.preferredSpiceLevel ?? DEFAULT_FORM.spiceLevel,
    allergies: preferences?.allergies ?? [],
    maxWaitMinutes: preferences?.maxWaitMinutes ?? DEFAULT_FORM.maxWaitMinutes,
  }));

  const [state, setState] = useState({ loading: false, error: null, data: null });
  const [rejecting, setRejecting] = useState(null);
  const [dismissed, setDismissed] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [alternativesFor, setAlternativesFor] = useState(null);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const toggleIn = (key, value) =>
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((v) => v !== value) : [...current[key], value],
    }));

  const payload = useMemo(
    () => ({
      mood: form.mood,
      hungerLevel: form.hungerLevel,
      budget: Number(form.budget),
      priceCategory: form.priceCategory,
      dietType: form.dietType,
      spiceLevel: form.spiceLevel,
      cuisines: form.cuisines,
      caloriePreference: form.caloriePreference,
      highProtein: form.highProtein,
      allergies: form.allergies,
      avoid: form.avoid.split(',').map((v) => v.trim()).filter(Boolean),
      maxWaitMinutes: Number(form.maxWaitMinutes),
      fulfilment: form.fulfilment,
      location: location ? { lat: location.lat, lng: location.lng } : null,
      limit: 8,
    }),
    [form, location]
  );

  const submit = async (event) => {
    event?.preventDefault();
    setState({ loading: true, error: null, data: null });
    setDismissed([]);
    try {
      const data = await api.recommendFoods(payload);
      setState({ loading: false, error: null, data });
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (error) {
      setState({ loading: false, error, data: null });
    }
  };

  const loadAlternatives = async (item) => {
    setAlternativesFor({ item, loading: true, items: [] });
    try {
      const data = await api.alternatives({
        ...payload,
        excludeFoodIds: [item.food.id, ...dismissed],
        limit: 6,
      });
      setAlternativesFor({ item, loading: false, items: data.items });
    } catch (error) {
      toast.error(error.message);
      setAlternativesFor(null);
    }
  };

  const addToCart = (item) => {
    const { replaced } = add(item.food, item.restaurant, 1);
    toast.success(replaced ? `Cart replaced with ${item.food.name}` : `${item.food.name} added to cart`);
  };

  const orderNow = (item) => {
    add(item.food, item.restaurant, 1);
    navigate('/cart');
  };

  const items = (state.data?.items ?? []).filter((item) => !dismissed.includes(item.food.id));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">What should I eat?</h1>
        <p className="mt-1 text-sm muted">
          Pick how you feel right now. We score every dish on nearby menus against it — nothing is invented.
        </p>
      </header>

      <form onSubmit={submit} className="card space-y-6 p-5">
        <fieldset>
          <legend className="label">How are you feeling? <span className="font-normal muted">(optional)</span></legend>
          <div className="flex flex-wrap gap-2">
            {MOODS.map((mood) => (
              <Chip
                key={mood.id}
                active={form.mood === mood.id}
                onClick={() => set({ mood: form.mood === mood.id ? null : mood.id })}
              >
                <span aria-hidden="true">{mood.emoji}</span> {mood.label}
              </Chip>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-6 sm:grid-cols-2">
          <fieldset>
            <legend className="label">How hungry are you?</legend>
            <div className="flex flex-wrap gap-2">
              {HUNGER_LEVELS.map((level) => (
                <Chip key={level.id} active={form.hungerLevel === level.id} onClick={() => set({ hungerLevel: level.id })}>
                  <span aria-hidden="true">{level.emoji}</span> {level.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">Diet</legend>
            <div className="flex flex-wrap gap-2">
              {DIET_TYPES.map((diet) => (
                <Chip
                  key={diet.id}
                  active={form.dietType === diet.id}
                  onClick={() => set({ dietType: form.dietType === diet.id ? null : diet.id })}
                >
                  <span aria-hidden="true">{diet.emoji}</span> {diet.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">Spice level</legend>
            <div className="flex flex-wrap gap-2">
              {SPICE_LEVELS.map((spice) => (
                <Chip key={spice.id} active={form.spiceLevel === spice.id} onClick={() => set({ spiceLevel: spice.id })}>
                  <span aria-hidden="true">{spice.emoji}</span> {spice.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="label" htmlFor="budget">
              Budget per dish — <span className="text-brand-600">₹{form.budget}</span>
            </label>
            <input
              id="budget"
              type="range"
              min="50"
              max="1000"
              step="10"
              value={form.budget}
              onChange={(event) => set({ budget: Number(event.target.value) })}
              className="w-full accent-brand-600"
            />
            <div className="flex justify-between text-xs muted">
              <span>₹50</span><span>₹1000</span>
            </div>

            {/* Price band, alongside the exact budget. The slider says "no more
                than this"; the band says which kind of place to look at. */}
            <div className="mt-3">
              <span className="label">Price range</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {PRICE_CATEGORIES.map((price) => (
                  <Chip
                    key={price.id}
                    active={form.priceCategory === price.id}
                    onClick={() => set({ priceCategory: form.priceCategory === price.id ? null : price.id })}
                    title={price.hint}
                  >
                    {price.label}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            className="text-sm font-bold text-brand-700 hover:underline dark:text-brand-400"
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? 'Hide extra preferences' : 'More preferences (cuisine, calories, allergies, waiting time)'}
          </button>

          {showAdvanced && (
            <div className="mt-4 grid animate-fade-up gap-6 border-t border-ink-100 pt-4 sm:grid-cols-2 dark:border-ink-800">
              <fieldset className="sm:col-span-2">
                <legend className="label">Preferred cuisines</legend>
                <div className="flex flex-wrap gap-2">
                  {CUISINES.map((cuisine) => (
                    <Chip key={cuisine.id} active={form.cuisines.includes(cuisine.id)} onClick={() => toggleIn('cuisines', cuisine.id)}>
                      {cuisine.label}
                    </Chip>
                  ))}
                </div>
              </fieldset>

              <div>
                <label className="label" htmlFor="calories">Calorie preference</label>
                <select
                  id="calories"
                  className="field"
                  value={form.caloriePreference}
                  onChange={(event) => set({ caloriePreference: event.target.value })}
                >
                  {CALORIE_PREFERENCES.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs muted">Calorie figures shown are estimates for a typical serving.</p>
              </div>

              <div>
                <label className="label" htmlFor="wait">
                  Maximum waiting time — <span className="text-brand-600">{form.maxWaitMinutes} min</span>
                </label>
                <input
                  id="wait"
                  type="range"
                  min="10"
                  max="120"
                  step="5"
                  value={form.maxWaitMinutes}
                  onChange={(event) => set({ maxWaitMinutes: Number(event.target.value) })}
                  className="w-full accent-brand-600"
                />
                <div className="mt-3">
                  <Toggle
                    checked={form.highProtein}
                    onChange={(value) => set({ highProtein: value })}
                    label="High protein"
                    description="Favour dishes with more protein per calorie."
                  />
                </div>
              </div>

              <fieldset className="sm:col-span-2">
                <legend className="label">Allergies — these are hard filters</legend>
                <div className="flex flex-wrap gap-2">
                  {ALLERGENS.map((allergen) => (
                    <Chip key={allergen.id} active={form.allergies.includes(allergen.id)} onClick={() => toggleIn('allergies', allergen.id)}>
                      {allergen.label}
                    </Chip>
                  ))}
                </div>
                <p className="mt-2 text-xs muted">
                  Anything containing a selected allergen is removed entirely. Allergen data comes from the listed
                  menu information — always confirm with the restaurant if you have a severe allergy.
                </p>
              </fieldset>

              <div className="sm:col-span-2">
                <label className="label" htmlFor="avoid">Foods to avoid today</label>
                <input
                  id="avoid"
                  className="field"
                  placeholder="e.g. rice, mushroom"
                  value={form.avoid}
                  onChange={(event) => set({ avoid: event.target.value })}
                />
              </div>

              <fieldset className="sm:col-span-2">
                <legend className="label">I want to</legend>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'any', label: 'Either is fine' },
                    { id: 'delivery', label: 'Order online' },
                    { id: 'dinein', label: 'Go to the restaurant' },
                  ].map((option) => (
                    <Chip key={option.id} active={form.fulfilment === option.id} onClick={() => set({ fulfilment: option.id })}>
                      {option.label}
                    </Chip>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-4 dark:border-ink-800">
          <button type="submit" className="btn-primary flex-1 sm:flex-none sm:px-8" disabled={state.loading}>
            {state.loading ? 'Finding your food…' : '🍽️ Find my food'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setForm(DEFAULT_FORM)}>Reset</button>
          {!location && (
            <span className="text-xs muted">
              Tip: share your location on the <strong>Near me</strong> screen for distance-aware results.
            </span>
          )}
        </div>
      </form>

      <div ref={resultsRef}>
        {state.loading && <Loading label="Scoring nearby menus against your preferences…" />}
        {state.error && <ErrorState error={state.error} onRetry={submit} />}

        {state.data && !state.loading && (
          <section className="space-y-4">
            <SectionHeader
              title={items.length ? 'Your recommendations' : 'No match found'}
              subtitle={
                items.length
                  ? `${state.data.meta.candidateCount} dishes considered · ranked in ${state.data.meta.tookMs} ms`
                  : undefined
              }
            />

            {items.length ? (
              items.map((item, index) => (
                <RecommendationCard
                  key={item.id}
                  item={item}
                  rank={index + 1}
                  highlight={index === 0}
                  onAddToCart={addToCart}
                  onOrderNow={orderNow}
                  onShowAlternatives={loadAlternatives}
                  onFindNearby={() => navigate('/near-me')}
                  onReject={(target) => setRejecting(target)}
                />
              ))
            ) : (
              <EmptyState
                emoji="🤔"
                title="Nothing matched all of that"
                description="Try raising the budget, relaxing the waiting limit, or removing an avoided ingredient."
                action={
                  <button type="button" className="btn-secondary mt-2" onClick={() => set({ budget: Math.round(form.budget * 1.5) })}>
                    Raise budget to ₹{Math.round(form.budget * 1.5)}
                  </button>
                }
              />
            )}
          </section>
        )}
      </div>

      <FeedbackModal
        item={rejecting}
        recommendationId={state.data?.recommendationId}
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        onSubmitted={(item) => setDismissed((current) => [...current, item.food.id])}
      />

      <Modal
        open={Boolean(alternativesFor)}
        onClose={() => setAlternativesFor(null)}
        title={`Alternatives to ${alternativesFor?.item?.food?.name ?? ''}`}
        size="max-w-2xl"
      >
        {alternativesFor?.loading ? (
          <Loading label="Finding alternatives…" />
        ) : alternativesFor?.items?.length ? (
          <div className="space-y-3">
            {alternativesFor.items.map((item) => (
              <div key={item.id} className={cx('flex items-center gap-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800')}>
                <span className="text-3xl" aria-hidden="true">{item.food.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{item.food.name}</p>
                  <p className="truncate text-xs muted">
                    {item.restaurant.name} · ₹{item.food.price} · {item.matchPercent}% match
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
                  onClick={() => { addToCart(item); setAlternativesFor(null); }}
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm muted">No other options matched. Try loosening a filter.</p>
        )}
      </Modal>
    </div>
  );
}
