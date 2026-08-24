import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useCart } from '../context/CartContext.jsx';
import { useLocation } from '../context/LocationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { CHAT_SUGGESTIONS } from '../lib/constants.js';
import { RecommendationCard } from '../components/RecommendationCard.jsx';
import { FeedbackModal } from '../components/FeedbackModal.jsx';
import { Spinner } from '../components/ui.jsx';
import { cx, titleCase } from '../lib/format.js';

const GREETING = {
  role: 'assistant',
  content:
    "Tell me what's going on — how hungry you are, your budget, what you're craving, how far you'll go. " +
    "I'll search the actual menus near you and explain why I picked what I picked.",
};

/** Chips summarising what the parser understood, so the user can see and correct it. */
function UnderstoodChips({ context }) {
  if (!context) return null;

  const chips = [
    context.mood && ['Mood', titleCase(context.mood)],
    context.hungerLevel && ['Hunger', titleCase(context.hungerLevel)],
    context.budget && ['Budget', `≤ ₹${context.budget}`],
    context.dietType && ['Diet', titleCase(context.dietType)],
    context.spiceLevel && ['Spice', titleCase(context.spiceLevel)],
    context.keywords?.length && ['Wants', context.keywords.join(', ')],
    context.avoid?.length && ['Avoiding', context.avoid.join(', ')],
    context.maxWaitMinutes && ['Max wait', `${context.maxWaitMinutes} min`],
    context.maxDistanceKm && ['Within', `${context.maxDistanceKm} km`],
    context.weather && ['Weather', `${context.weather.temperatureC}° ${context.weather.condition}`],
  ].filter(Boolean);

  if (!chips.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map(([label, value]) => (
        <span
          key={label}
          className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300"
        >
          <span className="font-bold">{label}:</span> {value}
        </span>
      ))}
    </div>
  );
}

export default function AskAI() {
  const { location } = useLocation();
  const { add } = useCart();
  const toast = useToast();
  const navigate = useNavigate();

  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const endRef = useRef(null);

  const { data: aiStatus } = useAsync(() => api.aiStatus(), []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message || sending) return;

    setInput('');
    setSending(true);
    setMessages((current) => [...current, { role: 'user', content: message }]);

    try {
      const response = await api.chat({
        message,
        // Only the plain conversation is replayed — result payloads stay client-side.
        history: messages
          .filter((m) => m.content)
          .slice(-6)
          .map((m) => ({ role: m.role, content: m.content })),
        location: location ? { lat: location.lat, lng: location.lng } : null,
      });

      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: response.reply,
          items: response.items,
          context: response.resolvedContext,
          recommendationId: response.recommendationId,
          source: response.replySource,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: error.message, isError: true },
      ]);
    } finally {
      setSending(false);
    }
  };

  const addToCart = (item) => {
    const { replaced } = add(item.food, item.restaurant, 1);
    toast.success(replaced ? `Cart replaced with ${item.food.name}` : `${item.food.name} added to cart`);
  };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Ask AI what to eat</h1>
        <p className="mt-1 text-sm muted">
          Say it however you like. The assistant only recommends dishes that actually exist on nearby menus —
          it reads them from this app’s database, it does not make them up.
          {aiStatus && !aiStatus.enabled && (
            <span className="mt-1 block text-xs">
              ⚙️ Running on the built-in rule-based parser (no <code>ANTHROPIC_API_KEY</code> configured). Everything
              still works; replies are template-generated.
            </span>
          )}
        </p>
      </header>

      <div className="card flex min-h-[60vh] flex-col overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.map((message, index) => (
            <div key={index} className="animate-fade-up">
              <div className={cx('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cx(
                    'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                    message.role === 'user'
                      ? 'rounded-br-sm bg-brand-600 text-white'
                      : message.isError
                        ? 'rounded-bl-sm bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200'
                        : 'rounded-bl-sm bg-ink-100 text-ink-800 dark:bg-ink-800 dark:text-ink-100'
                  )}
                >
                  {message.content}
                  {message.role === 'assistant' && message.source === 'template' && !message.isError && index > 0 && (
                    <span className="mt-1 block text-[11px] opacity-60">Generated from the engine’s own results.</span>
                  )}
                </div>
              </div>

              {message.role === 'assistant' && <UnderstoodChips context={message.context} />}

              {message.items?.length > 0 && (
                <div className="mt-3 space-y-3">
                  {message.items.slice(0, 3).map((item, itemIndex) => (
                    <RecommendationCard
                      key={item.id}
                      item={item}
                      rank={itemIndex + 1}
                      highlight={itemIndex === 0}
                      onAddToCart={addToCart}
                      onOrderNow={(target) => { addToCart(target); navigate('/cart'); }}
                      onReject={setRejecting}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div className="flex items-center gap-2 text-sm muted">
              <Spinner className="h-4 w-4" /> Reading nearby menus…
            </div>
          )}
          <div ref={endRef} />
        </div>

        {messages.length <= 2 && (
          <div className="no-scrollbar flex gap-2 overflow-x-auto border-t border-ink-100 px-4 py-3 dark:border-ink-800">
            {CHAT_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="chip-idle shrink-0 whitespace-nowrap text-xs"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(event) => { event.preventDefault(); send(); }}
          className="flex gap-2 border-t border-ink-100 p-3 dark:border-ink-800"
        >
          <label className="sr-only" htmlFor="chat-input">Your message</label>
          <input
            id="chat-input"
            className="field flex-1"
            placeholder="e.g. I'm tired and want something light under ₹200"
            value={input}
            maxLength={600}
            onChange={(event) => setInput(event.target.value)}
            disabled={sending}
          />
          <button type="submit" className="btn-primary px-5" disabled={sending || !input.trim()}>
            {sending ? <Spinner className="h-4 w-4" /> : 'Ask'}
          </button>
        </form>
      </div>

      <p className="text-xs muted">
        Nutrition figures are estimates. Recommendations reflect your stated preferences and are not health or
        medical advice.
      </p>

      <FeedbackModal
        item={rejecting}
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        onSubmitted={() => toast.success('Thanks — that will shape future suggestions.')}
      />
    </div>
  );
}
