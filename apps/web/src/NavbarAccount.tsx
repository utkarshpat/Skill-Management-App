import { useId, useState } from 'react';
import { Bell, LogOut } from 'lucide-react';
import { ThemeSwitcher } from './Theme';
import { signOut } from './auth';

export function NavbarAccount({name,identity}:{name:string;identity:string}) {
  const id=useId(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const initials=name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('');
  return <div className="navbar-account-controls">
    <ThemeSwitcher/>
    <button className="navbar-icon" type="button" aria-label="Notifications" popoverTarget={id+'-notifications'}><Bell size={21}/></button>
    <section id={id+'-notifications'} popover="auto" className="navbar-popover notification-popover" aria-label="Notifications">
      <h2>Notifications</h2><div className="notification-empty"><Bell size={24} aria-hidden="true"/><p>No notifications available yet.</p></div>
    </section>
    <button className="navbar-avatar" type="button" aria-label={'Account menu for '+name} popoverTarget={id+'-account'}><span aria-hidden="true">{initials}</span></button>
    <section id={id+'-account'} popover="auto" className="navbar-popover account-popover" aria-label="Account menu">
      <strong>{name}</strong><p className="account-identity">{identity}</p>
      {error&&<p role="alert">{error}</p>}
      <button className="secondary-button account-signout" disabled={busy} onClick={()=>{setBusy(true);setError('');signOut().catch(()=>{setError('Sign out could not finish. Please try again.');setBusy(false);});}}><LogOut size={17}/>{busy?'Signing out…':'Sign out'}</button>
    </section>
  </div>;
}
