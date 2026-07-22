import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import LoginPage from './LoginPage';
import { getAdminKey } from './api';
import { logout, refreshAuthToken, watchAuth } from './firebase';
import OperationsTab from './tabs/OperationsTab';
import FinanceTab from './tabs/FinanceTab';
import FleetTab from './tabs/FleetTab';
import GrowthTab from './tabs/GrowthTab';
import AiTab from './tabs/AiTab';

type Tab = 'operations' | 'finance' | 'fleet' | 'growth' | 'ai';

const TABS: { id: Tab; label: string }[] = [
  { id: 'operations', label: 'Operations' },
  { id: 'finance', label: 'Finance' },
  { id: 'fleet', label: 'Fleet' },
  { id: 'growth', label: 'Growth' },
  { id: 'ai', label: 'AI' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('operations');
  const [loggedIn, setLoggedIn] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onError = useCallback((msg: string | null) => setError(msg), []);

  useEffect(() => {
    const hasDevAuth = !!getAdminKey() || !import.meta.env.PROD;
    if (hasDevAuth && getAdminKey()) {
      setLoggedIn(true);
    }

    return watchAuth((firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        setLoggedIn(true);
      } else if (!getAdminKey() && import.meta.env.PROD) {
        setLoggedIn(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    const id = setInterval(() => {
      refreshAuthToken().catch(() => {});
    }, 45 * 60 * 1000);
    return () => clearInterval(id);
  }, [loggedIn]);

  async function handleLogout() {
    await logout();
    setLoggedIn(false);
    setUser(null);
  }

  if (!loggedIn) {
    return <LoginPage onLoggedIn={() => setLoggedIn(true)} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Guardian Mission Control</h1>
          <p className="subtitle">Real-time ops · cost modelling · AI observability</p>
        </div>
        <div className="topbar-actions">
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'tab active' : 'tab'}
                onClick={() => setTab(t.id)}
                type="button"
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="user-bar">
            {user?.email ? <span className="muted">{user.email}</span> : <span className="muted">Dev API key</span>}
            <button type="button" className="btn-secondary btn-sm" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </header>

      {error ? <div className="banner error">{error}</div> : null}

      {tab === 'operations' ? <OperationsTab onError={onError} /> : null}
      {tab === 'finance' ? <FinanceTab onError={onError} /> : null}
      {tab === 'fleet' ? <FleetTab onError={onError} /> : null}
      {tab === 'growth' ? <GrowthTab onError={onError} /> : null}
      {tab === 'ai' ? <AiTab onError={onError} /> : null}
    </div>
  );
}
