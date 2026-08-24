import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Chip, EmptyState, ErrorState } from '../components/ui.jsx';
import { minutes, rupees } from '../lib/format.js';

const PAYMENT_METHODS = [
  { id: 'demo_upi', label: 'UPI (demo)', emoji: '📱' },
  { id: 'demo_card', label: 'Card (demo)', emoji: '💳' },
  { id: 'cash_on_delivery', label: 'Cash on delivery', emoji: '💵' },
];

export default function Checkout() {
  const { restaurant, items, totals, clear } = useCart();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const defaultAddress = user?.addresses?.find((a) => a.isDefault) ?? user?.addresses?.[0];

  const [fulfilment, setFulfilment] = useState('delivery');
  const [paymentMethod, setPaymentMethod] = useState('demo_upi');
  const [address, setAddress] = useState({
    label: defaultAddress?.label ?? 'Home',
    line1: defaultAddress?.line1 ?? '',
    line2: defaultAddress?.line2 ?? '',
    city: defaultAddress?.city ?? '',
    pincode: defaultAddress?.pincode ?? '',
  });
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!items.length) {
    return (
      <EmptyState
        emoji="🛒"
        title="Nothing to check out"
        action={<Link to="/decide" className="btn-primary mt-2">Find something to eat</Link>}
      />
    );
  }

  const placeOrder = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await api.createOrder({
        items: items.map(({ food, quantity }) => ({ foodId: food.id, quantity })),
        fulfilment,
        address: fulfilment === 'delivery' ? address : undefined,
        paymentMethod,
        notes: notes.trim() || undefined,
      });
      clear();
      toast.success('Order placed — this is a simulated payment.');
      navigate(`/orders/${response.order.id}`);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setSubmitting(false);
    }
  };

  const deliveryFee = fulfilment === 'delivery' ? totals.deliveryFee : 0;
  const total = totals.subtotal + deliveryFee + totals.taxes;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold tracking-tight">Checkout</h1>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <strong className="font-bold">Demo payment.</strong> No payment gateway is connected. Nothing is charged
        and no card or UPI details are collected or stored.
      </div>

      {error && <ErrorState error={error} />}

      <form onSubmit={placeOrder} className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <fieldset className="card p-4">
            <legend className="label">How do you want it?</legend>
            <div className="flex flex-wrap gap-2">
              <Chip active={fulfilment === 'delivery'} onClick={() => setFulfilment('delivery')}>🛵 Deliver to me</Chip>
              <Chip active={fulfilment === 'pickup'} onClick={() => setFulfilment('pickup')}>🏃 I&apos;ll pick it up</Chip>
            </div>
          </fieldset>

          {fulfilment === 'delivery' && (
            <fieldset className="card space-y-3 p-4">
              <legend className="label">Delivery address</legend>
              <div>
                <label className="label" htmlFor="line1">Address</label>
                <input
                  id="line1"
                  className="field"
                  required
                  minLength={4}
                  value={address.line1}
                  onChange={(event) => setAddress({ ...address, line1: event.target.value })}
                  placeholder="Flat / house, street"
                />
              </div>
              <div>
                <label className="label" htmlFor="line2">Landmark (optional)</label>
                <input
                  id="line2"
                  className="field"
                  value={address.line2}
                  onChange={(event) => setAddress({ ...address, line2: event.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="city">City</label>
                  <input id="city" className="field" value={address.city} onChange={(event) => setAddress({ ...address, city: event.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="pincode">PIN code</label>
                  <input id="pincode" className="field" value={address.pincode} onChange={(event) => setAddress({ ...address, pincode: event.target.value })} />
                </div>
              </div>
            </fieldset>
          )}

          <fieldset className="card p-4">
            <legend className="label">Payment method</legend>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((method) => (
                <Chip key={method.id} active={paymentMethod === method.id} onClick={() => setPaymentMethod(method.id)}>
                  <span aria-hidden="true">{method.emoji}</span> {method.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <div className="card p-4">
            <label className="label" htmlFor="notes">Notes for the restaurant (optional)</label>
            <textarea
              id="notes"
              className="field"
              rows={2}
              maxLength={300}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="e.g. less spicy, no onions"
            />
          </div>
        </div>

        <aside className="card h-fit space-y-3 p-4">
          <h2 className="text-sm font-bold">{restaurant?.emoji} {restaurant?.name}</h2>
          <ul className="space-y-1.5 text-sm">
            {items.map(({ food, quantity }) => (
              <li key={food.id} className="flex justify-between gap-2">
                <span className="truncate muted">{quantity}× {food.name}</span>
                <span className="shrink-0 tabular-nums">{rupees(food.price * quantity)}</span>
              </li>
            ))}
          </ul>

          <dl className="space-y-1.5 border-t border-ink-100 pt-3 text-sm dark:border-ink-800">
            <div className="flex justify-between"><dt className="muted">Subtotal</dt><dd className="tabular-nums">{rupees(totals.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="muted">Delivery</dt><dd className="tabular-nums">{deliveryFee ? rupees(deliveryFee) : 'Free'}</dd></div>
            <div className="flex justify-between"><dt className="muted">Taxes</dt><dd className="tabular-nums">{rupees(totals.taxes)}</dd></div>
            <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-extrabold dark:border-ink-800">
              <dt>Total</dt><dd className="tabular-nums">{rupees(total)}</dd>
            </div>
          </dl>

          <p className="text-xs muted">
            Estimated {fulfilment === 'delivery' ? 'delivery' : 'pickup'} in about {minutes(30)} — the exact
            estimate is calculated from the kitchen’s current load when you place the order.
          </p>

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? 'Placing order…' : `Place order · ${rupees(total)}`}
          </button>
        </aside>
      </form>
    </div>
  );
}
