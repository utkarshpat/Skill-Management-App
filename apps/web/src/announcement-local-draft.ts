import type { Definition } from './announcement-model';

export interface LocalAnnouncementDraft {
  schema: 1;
  grantId: string;
  draftId?: string;
  revision: number;
  definition: Definition;
  start: string;
  end: string;
  image?: string;
  prompt: string;
  step?: 'details' | 'design';
  savedAt: number;
}
export const localAnnouncementKey = (actor: string) => 'announcement-draft:v1:' + actor;
export function readLocalAnnouncement(actor: string): LocalAnnouncementDraft | undefined {
  try {
    const json = localStorage.getItem(localAnnouncementKey(actor));
    if (!json || json.length > 1_200_000) return;
    const value = JSON.parse(json) as LocalAnnouncementDraft;
    if (
      value.schema !== 1 ||
      !value.grantId ||
      !value.definition ||
      !Array.isArray(value.definition.fields) ||
      !Array.isArray(value.definition.audience) ||
      !Array.isArray(value.definition.versions) ||
      !Array.isArray(value.definition.options) ||
      !Array.isArray(value.definition.exports) ||
      typeof value.start !== 'string' ||
      typeof value.end !== 'string' ||
      typeof value.prompt !== 'string' ||
      typeof value.revision !== 'number' ||
      Date.now() - value.savedAt > 30 * 86_400_000
    )
      return;
    return value;
  } catch {
    return;
  }
}
export function writeLocalAnnouncement(actor: string, draft: LocalAnnouncementDraft) {
  try {
    const text = JSON.stringify(draft);
    if (text.length > 1_200_000) return false;
    localStorage.setItem(localAnnouncementKey(actor), text);
    return true;
  } catch {
    return false;
  }
}
export function removeLocalAnnouncement(actor: string) {
  try {
    localStorage.removeItem(localAnnouncementKey(actor));
  } catch {
    /* The in-memory editor remains usable. */
  }
}
