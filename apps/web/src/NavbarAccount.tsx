import { useId, useState } from 'react';
import { Link } from 'react-router';
import { LogOut, RefreshCw } from 'lucide-react';
import { Notifications } from './Notifications';
import { ThemeSwitcher } from './Theme';
import { signOut } from './auth';

export function NavbarAccount({
  name,
  identity,
  workspaceLink,
  onRefresh,
  refreshing,
}: {
  name: string;
  identity: string;
  workspaceLink?: { href: string; label: string };
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const id = useId(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join('');
  return (
    <div className="navbar-account-controls">
      {onRefresh && (
        <button
          className="navbar-icon navbar-refresh-btn"
          type="button"
          aria-label="Refresh dashboard"
          title="Refresh dashboard"
          onClick={onRefresh}
        >
          <RefreshCw size={18} className={refreshing ? 'spin-icon' : ''} />
        </button>
      )}
      <ThemeSwitcher />
      <Notifications id={id + '-notifications'} />
      <button
        className="navbar-avatar"
        type="button"
        aria-label={'Account menu for ' + name}
        popoverTarget={id + '-account'}
      >
        <span aria-hidden="true">{initials}</span>
      </button>
      <section
        id={id + '-account'}
        popover="auto"
        className="navbar-popover account-popover"
        aria-label="Account menu"
      >
        <strong>{name}</strong>
        <p className="account-identity">{identity}</p>
        {workspaceLink && (
          <Link
            className="secondary-button account-context"
            to={workspaceLink.href}
            onClick={event => event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()}
          >
            {workspaceLink.label}
          </Link>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          className="secondary-button account-signout"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            signOut().catch(() => {
              setError('Sign out could not finish. Please try again.');
              setBusy(false);
            });
          }}
        >
          <LogOut size={17} />
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </section>
    </div>
  );
}
