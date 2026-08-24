import { useState } from 'react';
import { Modal } from './ui.jsx';
import { CrowdBadge } from './CrowdBadge.jsx';
import { api } from '../lib/api.js';
import { useLocation } from '../context/LocationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { cx } from '../lib/format.js';

const REPORT_LEVELS = [
  { id: 'empty', label: 'Empty', emoji: '🫙' },
  { id: 'low', label: 'Low', emoji: '🟢' },
  { id: 'moderate', label: 'Moderate', emoji: '🟡' },
  { id: 'crowded', label: 'Crowded', emoji: '🟠' },
  { id: 'very_crowded', label: 'Very crowded', emoji: '🔴' },
];

/** "I'm currently at this restaurant" — feeds the live crowd signal. */
export function CheckInDialog({ place, open, onClose, onDone }) {
  const { location } = useLocation();
  const toast = useToast();
  const [partySize, setPartySize] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const close = () => {
    setResult(null);
    setPartySize(1);
    onClose();
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const response = await api.checkIn(place.id, {
        partySize,
        location: location ? { lat: location.lat, lng: location.lng } : null,
      });
      setResult(response);
      onDone?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!place) return null;

  return (
    <Modal
      open={open}
      onClose={close}
      title={result ? 'Checked in' : `Are you at ${place.name}?`}
      footer={
        result ? (
          <button type="button" className="btn-primary" onClick={close}>Done</button>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
            <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
              {submitting ? 'Checking in…' : "Yes, I'm here"}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-700 dark:text-ink-300">{result.message}</p>
          <CrowdBadge crowd={result.crowd} size="md" />
          <p className="text-xs muted">{result.privacyNote}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm muted">
            Checking in helps everyone else see how busy this place is right now. It is stored anonymously,
            without your identity, and expires automatically after a couple of hours.
          </p>
          <div>
            <span className="label">How many of you?</span>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 6, 8].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setPartySize(size)}
                  className={cx(partySize === size ? 'chip-active' : 'chip-idle', 'min-w-[44px] justify-center')}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Post-visit crowd feedback. This is the ground-truth signal for the estimator. */
export function CrowdReportDialog({ place, open, onClose, onDone }) {
  const toast = useToast();
  const [level, setLevel] = useState(null);
  const [wait, setWait] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const close = () => {
    setLevel(null);
    setWait('');
    setResult(null);
    onClose();
  };

  const submit = async () => {
    if (!level) {
      toast.error('Pick how busy it was.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.crowdReport(place.id, {
        level,
        observedWaitMinutes: wait === '' ? null : Number(wait),
      });
      setResult(response);
      onDone?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!place) return null;

  return (
    <Modal
      open={open}
      onClose={close}
      title={result ? 'Thanks for the report' : `How busy is ${place.name}?`}
      footer={
        result ? (
          <button type="button" className="btn-primary" onClick={close}>Done</button>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
            <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
              {submitting ? 'Sending…' : 'Submit report'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-700 dark:text-ink-300">
            Your report is now part of this venue’s historical pattern for this day and hour.
          </p>
          <CrowdBadge crowd={result.crowd} size="md" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {REPORT_LEVELS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setLevel(option.id)}
                className={cx(level === option.id ? 'chip-active' : 'chip-idle')}
                aria-pressed={level === option.id}
              >
                <span aria-hidden="true">{option.emoji}</span> {option.label}
              </button>
            ))}
          </div>
          <div>
            <label className="label" htmlFor="observed-wait">How long did you wait? (optional)</label>
            <input
              id="observed-wait"
              type="number"
              min="0"
              max="240"
              className="field"
              placeholder="minutes"
              value={wait}
              onChange={(event) => setWait(event.target.value)}
            />
          </div>
          <p className="text-xs muted">
            Reports are anonymous and are used to improve this app’s own crowd estimates.
          </p>
        </div>
      )}
    </Modal>
  );
}
