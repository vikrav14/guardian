import { useState } from 'react';
import { getAdminKey, setAdminKey } from './api';
import { loginWithEmail, loginWithGoogle } from './firebase';

type Props = {
  onLoggedIn: () => void;
};

export default function LoginPage({ onLoggedIn }: Props) {
  const [adminKey, setAdminKeyState] = useState(getAdminKey());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGoogle() {
    setLoading(true);
    setError(null);
    try {
      await loginWithGoogle();
      onLoggedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loginWithEmail(email, password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  function handleDevKey(e: React.FormEvent) {
    e.preventDefault();
    setAdminKey(adminKey);
    onLoggedIn();
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <h1>Guardian Mission Control</h1>
        <p className="muted">Sign in with Firebase (admin claim or allowlisted email) or use dev API key.</p>

        {error ? <div className="banner error">{error}</div> : null}

        <button type="button" className="btn-google" onClick={handleGoogle} disabled={loading}>
          Continue with Google
        </button>

        <form className="login-form" onSubmit={handleEmail}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button type="submit" disabled={loading}>Sign in with email</button>
        </form>

        <hr className="login-divider" />

        <form onSubmit={handleDevKey}>
          <label>
            Dev admin API key
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKeyState(e.target.value)}
              placeholder="X-Admin-Key (optional in dev)"
            />
          </label>
          <button type="submit" className="btn-secondary">Enter with API key</button>
        </form>
      </div>
    </div>
  );
}
