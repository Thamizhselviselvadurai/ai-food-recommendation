import { useState } from 'react';
import { Modal } from './ui.jsx';
import { REJECTION_REASONS } from '../lib/constants.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { cx } from '../lib/format.js';

/**
 * "❌ I don't like this recommendation" → why → the profile actually changes.
 * The response lists what was learned, so personalisation is never a black box.
 */
export function FeedbackModal({ item, recommendationId, open, onClose, onSubmitted }) {
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const [reasons, setReasons] = useState([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [learned, setLearned] = useState(null);

  const toggle = (id) =>
    setReasons((current) => (current.includes(id) ? current.filter((r) => r !== id) : [...current, id]));

  const reset = () => {
    setReasons([]);
    setComment('');
    setLearned(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!reasons.length) {
      toast.error('Pick at least one reason so we can learn from it.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.sendFeedback({
        sentiment: 'negative',
        reasons,
        comment: comment.trim() || undefined,
        foodId: item?.food?.id,
        restaurantId: item?.restaurant?.id,
        recommendationId,
      });
      setLearned(response.learned ?? []);
      onSubmitted?.(item, reasons);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <Modal open={open} onClose={handleClose} title="Sign in to personalise">
        <p className="text-sm muted">
          We can only remember what you don’t like once you have an account. Your feedback then shapes
          every future recommendation.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={handleClose}>Not now</button>
          <a href="/login" className="btn-primary">Sign in</a>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={learned ? 'Thanks — noted' : 'What was wrong with this suggestion?'}
      footer={
        learned ? (
          <button type="button" className="btn-primary" onClick={handleClose}>Done</button>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={handleClose}>Cancel</button>
            <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
              {submitting ? 'Saving…' : 'Submit feedback'}
            </button>
          </>
        )
      }
    >
      {learned ? (
        <div>
          <p className="text-sm text-ink-700 dark:text-ink-300">Here is what changed in your taste profile:</p>
          <ul className="mt-3 space-y-1.5">
            {learned.length ? (
              learned.map((entry) => (
                <li key={`${entry.field}-${entry.label}`} className="flex items-center gap-2 text-sm">
                  <span aria-hidden="true">{entry.direction === 'up' ? '↑' : '↓'}</span>
                  <span className="text-ink-800 dark:text-ink-200">We updated {entry.label}.</span>
                </li>
              ))
            ) : (
              <li className="text-sm muted">Recorded. It will be weighed against your future choices.</li>
            )}
          </ul>
          <p className="mt-3 text-xs muted">You can reset everything the app has learned from Profile → Personalisation.</p>
        </div>
      ) : (
        <div>
          {item?.food && (
            <p className="mb-3 text-sm muted">
              About <strong className="font-semibold text-ink-800 dark:text-ink-200">{item.food.name}</strong>
              {item.restaurant ? ` at ${item.restaurant.name}` : ''}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {REJECTION_REASONS.map((reason) => (
              <button
                key={reason.id}
                type="button"
                onClick={() => toggle(reason.id)}
                className={cx(reasons.includes(reason.id) ? 'chip-active' : 'chip-idle')}
                aria-pressed={reasons.includes(reason.id)}
              >
                {reason.label}
              </button>
            ))}
          </div>
          <label className="label mt-4" htmlFor="feedback-comment">Anything else? (optional)</label>
          <textarea
            id="feedback-comment"
            className="field"
            rows={2}
            maxLength={300}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Tell us more…"
          />
        </div>
      )}
    </Modal>
  );
}
