import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';

const preferenceKey = 'skill-management.sidebar-collapsed';

export function Sidebar({
  children,
  brandHref,
  onBrandClick,
  collapsible = false,
}: {
  children: ReactNode;
  brandHref: string;
  onBrandClick?: () => void;
  collapsible?: boolean;
}) {
  const sidebar = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return collapsible && localStorage.getItem(preferenceKey) === 'true';
    } catch {
      return false;
    }
  });
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(preferenceKey, String(next));
    } catch {
      // The sidebar can still be toggled when browser storage is unavailable.
    }
  }
  useEffect(() => {
    const element = sidebar.current;
    if (!element) return;
    // Even a sidebar shorter than its viewport must not scroll the document.
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY) return;
      const scroll = element.querySelector<HTMLElement>('.sidebar-scroll') ?? element;
      const atTop = scroll.scrollTop <= 0,
        atBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1;
      if (!(event.target instanceof Node) || !scroll.contains(event.target)) {
        event.preventDefault();
        return;
      }
      if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) event.preventDefault();
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  return (
    <aside
      ref={sidebar}
      className={'admin-sidebar' + (collapsible ? ' desktop-sidebar' : '')}
      data-collapsed={collapsed || undefined}
    >
      <div className="sidebar-heading">
        <Link
          className="admin-brand"
          to={brandHref}
          onClick={onBrandClick}
          aria-label="Sopra Steria"
          title={collapsed ? 'Sopra Steria' : undefined}
        >
          {collapsed ? (
            <img className="sidebar-brand-mark" src="/brand/sopra-steria-mark.svg" alt="" />
          ) : (
            <img src="/brand/sopra-steria.svg" alt="" />
          )}
        </Link>
        {collapsible && (
          <button
            type="button"
            className="sidebar-collapse-toggle"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleSidebar}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        )}
      </div>
      <p className="nav-caption">SKILL MANAGEMENT APP</p>
      {children}
    </aside>
  );
}
