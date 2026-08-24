import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { ErrorState } from '../components/ui.jsx';

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(form);
      toast.success('Welcome back!');
      navigate('/');
    } catch (requestError) {
      setError(requestError);
    } finally {
      setSubmitting(false);
    }
  };

  const useDemo = () => setForm({ email: 'demo@foodai.app', password: 'Demo@12345' });

  return (
    <div className="mx-auto max-w-md space-y-4 py-6">
      <header className="text-center">
        <div className="text-4xl" aria-hidden="true">🍜</div>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Welcome back</h1>
        <p className="text-sm muted">Sign in so recommendations learn what you actually like.</p>
      </header>

      {error && <ErrorState error={error} title="Could not sign in" />}

      <form onSubmit={submit} className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email" type="email" required autoComplete="email" className="field"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password" type="password" required autoComplete="current-password" className="field"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className="btn-secondary w-full" onClick={useDemo}>
          Fill in the demo account
        </button>
      </form>

      <p className="text-center text-sm muted">
        No account? <Link to="/register" className="font-bold text-brand-700 hover:underline dark:text-brand-400">Create one</Link>
      </p>
      <p className="text-center text-xs muted">
        You can browse, get recommendations and use the assistant without an account — signing in only adds
        personalisation, favourites and ordering.
      </p>
    </div>
  );
}
