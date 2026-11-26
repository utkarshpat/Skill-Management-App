import { Megaphone, BarChart3, BookOpen, Compass, ShieldCheck, UserRound } from 'lucide-react';

export const administrationShellFor = (pathname: string, administration: boolean) =>
  pathname === '/access' || administration;
export function personalPortfolioLabel(
  capabilities?: Pick<PersonalNavigationCapabilities, 'ownSkills' | 'certifications'>,
) {
  if (!capabilities || (capabilities.ownSkills && capabilities.certifications))
    return 'Skills & Certifications';
  return capabilities.certifications ? 'Certifications' : 'Skills';
}
export const personalPageTitle = (
  pathname: string | undefined,
  capabilities?: Pick<PersonalNavigationCapabilities, 'ownSkills' | 'certifications'>,
) =>
  pathname === '/announcements'
    ? 'Announcements'
    : pathname === '/business'
      ? 'Analytics'
      : pathname === '/requests'
        ? 'Requests & incidents'
        : pathname === '/learning'
          ? 'Learning & development'
          : pathname === '/skill-reviews'
            ? 'Approvals'
            : pathname === '/my-skills' || pathname === '/certifications'
              ? personalPortfolioLabel(capabilities)
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
    | {
        catalogue?: boolean;
        manageCatalogue?: boolean;
        reviewSkills?: boolean;
        amendments?: boolean;
        approveAmendments?: boolean;
      }
    | undefined,
) =>
  Boolean(
    capabilities?.catalogue &&
    (capabilities.manageCatalogue ||
      capabilities.reviewSkills ||
      capabilities.amendments ||
      capabilities.approveAmendments),
  );
const businessNavigationVisible = (
  capabilities:
    | { businessOperations?: boolean; businessAdministration?: boolean; issuerApprovals?: boolean }
    | undefined,
) => Boolean(capabilities?.businessOperations || capabilities?.issuerApprovals);
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
    '/announcements',
    '/preview',
    '/knowledgetransfer',
  ].includes(pathname);

interface PersonalNavigationCapabilities {
  ownProfile: boolean;
  canPublishAnnouncements?: boolean;
  ownSkills: boolean;
  reviewSkills?: boolean;
  issuerApprovals?: boolean;
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
    ...(businessNavigationVisible(capabilities)
      ? [{ id: 'business', label: 'Analytics', href: '/business', icon: BarChart3 }]
      : []),
    ...(capabilities.learning
      ? [{ id: 'learning', label: 'Learn & Grow', href: '/learning', icon: BookOpen }]
      : []),
    ...(capabilities.ownSkills || capabilities.certifications
      ? [
          {
            id: 'my-skills',
            label: personalPortfolioLabel(capabilities),
            href: capabilities.ownSkills ? '/my-skills' : '/certifications',
            icon: Compass,
          },
        ]
      : []),
    ...(capabilities.reviewSkills || capabilities.issuerApprovals
      ? [{ id: 'skill-reviews', label: 'Approvals', href: '/skill-reviews', icon: ShieldCheck }]
      : []),
    ...(capabilities.requests
      ? [{ id: 'requests', label: 'Requests', href: '/requests', icon: ShieldCheck }]
      : []),
    ...(capabilities.ownProfile && capabilities.canPublishAnnouncements
      ? [{ id: 'announcements', label: 'Announcements', href: '/announcements', icon: Megaphone }]
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
