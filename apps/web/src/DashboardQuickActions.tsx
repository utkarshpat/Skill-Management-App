import { Link } from 'react-router';
import { ArrowUpRight, BookOpen, FilePenLine, Inbox, Settings, Sparkles } from 'lucide-react';
export interface DashboardQuickAction {
  id: string;
  label: string;
  href: string;
  description: string;
  assistance?: { label: string; prompt?: string; href?: string };
}
export function DashboardQuickActions({
  actions,
  onAssist,
}: {
  actions: DashboardQuickAction[];
  onAssist: (prompt: string) => void;
}) {
  if (!actions.length) return null;
  return (
    <section className="dashboard-card dashboard-quick-actions" aria-label="Quick actions">
      <header>
        <h3>Quick actions</h3>
      </header>
      <ul className="dashboard-action-grid">
        {actions.map(a => {
          const Icon =
            (
              {
                skill: FilePenLine,
                learning: BookOpen,
                request: Inbox,
                administration: Settings,
              } as Record<string, typeof Inbox>
            )[a.id] ?? Inbox;
          return (
            <li key={a.id}>
              <Link className="dashboard-link" to={a.href}>
                <Icon size={17} aria-hidden="true" />
                {a.label}
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
              {a.assistance &&
                (a.assistance.href ? (
                  <Link className="dashboard-ai" to={a.assistance.href}>
                    <Sparkles size={15} />
                    {a.assistance.label}
                  </Link>
                ) : (
                  <button
                    className="dashboard-ai"
                    onClick={() => a.assistance?.prompt && onAssist(a.assistance.prompt)}
                  >
                    <Sparkles size={15} />
                    {a.assistance.label}
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
