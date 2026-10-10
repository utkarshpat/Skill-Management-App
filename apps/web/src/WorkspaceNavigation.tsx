import { SidebarNavigation } from './SidebarNavigation';
import { BarChart3, BookOpen, Compass, ShieldCheck, UserRound } from 'lucide-react';

export const administrationShellFor = (pathname: string, administration: boolean) =>
  pathname === '/access' || administration;
export const personalPageTitle = (pathname: string | undefined) =>
  pathname === '/business'
    ? 'Business Operations'
    : pathname === '/requests'
      ? 'Requests & incidents'
      : pathname === '/learning'
        ? 'Learning & development'
        : pathname === '/skill-reviews'
          ? 'Reviews'
          : pathname === '/my-skills'
            ? 'Capabilities'
            : pathname === '/certifications'
              ? 'Capabilities'
              : pathname === '/profile'
                ? 'My profile'
                : pathname === '/skills'
                  ? 'Skill catalogue'
                  : pathname === '/workspace'
                    ? 'My workspace'
                    : undefined;
export const catalogueRouteAllowed = (capabilities: { catalogue?: boolean } | undefined) =>
  capabilities?.catalogue === true;
export const catalogueNavigationVisible = (
  capabilities:
    { catalogue?: boolean; manageCatalogue?: boolean; reviewSkills?: boolean } | undefined,
) =>
  Boolean(capabilities?.catalogue && (capabilities.manageCatalogue || capabilities.reviewSkills));
export const isSupportedWorkspacePath = (pathname: string) =>
  [
    '/',
    '/access',
    '/workspace',
    '/profile',
    '/my-skills',
    '/certifications',
    '/skills',
    '/skill-reviews',
    '/learning',
    '/requests',
    '/business',
    '/preview',
    '/knowledgetransfer',
  ].includes(pathname);

export interface PersonalNavigationCapabilities {
  ownProfile: boolean;
  ownSkills: boolean;
  reviewSkills?: boolean;
  learning?: boolean;
  requests?: boolean;
  certifications?: boolean;
  businessOperations?: boolean;
  businessAdministration?: boolean;
  amendments?: boolean;
}
export function personalNavigationItems(
  capabilities?: PersonalNavigationCapabilities,
  pathname?: string,
) {
  if (!capabilities) return [];
  return [
    ...(capabilities.businessOperations ||
    capabilities.businessAdministration ||
    capabilities.amendments
      ? [{ id: 'business', label: 'Business Operations', href: '/business', icon: BarChart3 }]
      : []),
    ...(capabilities.learning
      ? [{ id: 'learning', label: 'Learn & Grow', href: '/learning', icon: BookOpen }]
      : []),
    ...(capabilities.ownSkills || capabilities.certifications
      ? [
          {
            id: 'my-skills',
            label: 'Capabilities',
            href: capabilities.ownSkills ? '/my-skills' : '/certifications',
            icon: Compass,
          },
        ]
      : []),
    ...(capabilities.reviewSkills
      ? [{ id: 'skill-reviews', label: 'Reviews', href: '/skill-reviews', icon: ShieldCheck }]
      : []),
    ...(capabilities.requests
      ? [{ id: 'requests', label: 'Requests', href: '/requests', icon: ShieldCheck }]
      : []),
    ...(capabilities.ownProfile
      ? [{ id: 'profile', label: 'My profile', href: '/profile', icon: UserRound }]
      : []),
  ].map(item => ({
    ...item,
    active:
      pathname === item.href ||
      (item.id === 'my-skills' && ['/my-skills', '/certifications'].includes(pathname ?? '')),
  }));
}
export function PersonalCapabilityNavigation({
  capabilities,
  pathname,
  onNavigate,
}: {
  capabilities?: PersonalNavigationCapabilities;
  pathname?: string;
  onNavigate: () => void;
}) {
  const items = personalNavigationItems(capabilities, pathname);
  if (!items.length) return null;
  return (
    <>
      <p className="nav-caption">MY CAPABILITY</p>
      <SidebarNavigation
        items={items}
        label="Personal capability sections"
        onNavigate={onNavigate}
      />
    </>
  );
}
