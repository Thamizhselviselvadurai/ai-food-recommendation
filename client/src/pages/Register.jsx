import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { ErrorState } from '../components/ui.jsx';

export default function Register() {
  const { register, isAuthenticated } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register({ ...form, phone: form.phone || undefined });
      toast.success('Account created — let’s set your tastes.');
      navigate('/profile');
    } catch (requestError) {
      setError(requestError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-4 py-6">
      <header className="text-center">
        <div className="text-4xl" aria-hidden="true">🍜</div>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Create your account</h1>
        <p className="text-sm muted">So the app can learn what you like and stop suggesting what you don’t.</p>
      </header>

      {error && <ErrorState error={error} title="Could not create the account" />}

      <form onSubmit={submit} className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input
            id="name" required minLength={2} className="field" autoComplete="name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email" type="email" required className="field" autoComplete="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password" type="password" required minLength={8} className="field" autoComplete="new-password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
          <p className="mt-1 text-xs muted">At least 8 characters.</p>
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone (optional)</label>
          <input
            id="phone" className="field" autoComplete="tel"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <p className="text-center text-sm muted">
        Already have an account? <Link to="/login" className="font-bold text-brand-700 hover:underline dark:text-brand-400">Sign in</Link>
      </p>
    </div>
  );
}
