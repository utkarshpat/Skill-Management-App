export const fields = [
  ['text', 'Short text'],
  ['longText', 'Long text'],
  ['choice', 'Dropdown'],
  ['checkbox', 'Checkbox'],
  ['date', 'Date'],
  ['rating', 'Rating (1–5)'],
] as const;

export const exportColumns = [
  ['du', 'Delivery Unit'],
  ['account', 'Account / Client'],
  ['portfolio', 'Portfolio'],
  ['grade', 'Grade'],
  ['capability', 'Capability'],
  ['primarySkill', 'Primary Skill'],
] as const;

export interface AnswerField {
  id: string;
  label: string;
  type: (typeof fields)[number][0];
  required: boolean;
  options: string[];
}
export interface Scope {
  id: string;
  kind: string;
}
export interface Design {
  order: string[];
  color: string;
  background: string;
  align: 'left' | 'center';
  layout: 'stack' | 'split';
  formLayout?: string;
  density?: string;
  buttonWidth?: string;
  html: string;
  css: string;
}
export interface Version {
  id: string;
  feedback: string;
  design: Design;
}
export interface Definition {
  kind: 'FORM' | 'POLL';
  useCase?: 'EVENT' | 'TRAINING' | 'SESSION' | 'SURVEY' | 'GENERAL';
  designViewport?: 'desktop' | 'mobile' | 'both';
  title: string;
  message: string;
  cta: string;
  fields: AnswerField[];
  options: string[];
  exports: string[];
  audience: Scope[];
  versions: Version[];
  selectedVersion?: string;
  design?: Design;
  popup: boolean;
  marquee: boolean;
  image?: string;
  imageAlt: string;
  imagePosition: 'left' | 'center' | 'right';
}
export interface RecordBase {
  id: string;
  revision: number;
  startsAt: string;
  endsAt: string;
}
export interface LiveAnnouncement extends RecordBase {
  definition: Definition;
  answered: boolean;
  hasImage: boolean;
}
export interface JournalEntry extends RecordBase {
  title: string;
  state: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  grantId: string;
}
export interface Draft extends Omit<JournalEntry, 'title'> {
  definition: Definition;
}
export interface Management {
  actorId?: string;
  grants: { id: string; kind: string; scopeId?: string }[];
  scopes: (Scope & { label: string; grantId: string; parentId?: string; parentKind?: string })[];
  items: JournalEntry[];
  aiAvailable: boolean;
  canExport: boolean;
}
export interface Person {
  name: string;
  email?: string;
  employeeId: string;
}
export const endpoint = '/api/announcements';
