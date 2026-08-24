export const rupees = (value) =>
  value == null ? '—' : `₹${Math.round(value).toLocaleString('en-IN')}`;

export const distance = (km) => {
  if (km == null) return null;
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
};

export const minutes = (value) => (value == null ? '—' : `${Math.round(value)} min`);

export function relativeTime(input) {
  const date = new Date(input);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export const hourLabel = (hour) => {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${suffix}`;
};

export const titleCase = (value) =>
  String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const orderStatusLabel = (status) =>
  ({
    placed: 'Order placed',
    confirmed: 'Confirmed by restaurant',
    preparing: 'Being prepared',
    out_for_delivery: 'Out for delivery',
    ready_for_pickup: 'Ready for pickup',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  }[status] ?? titleCase(status));

export const cx = (...values) => values.filter(Boolean).join(' ');
