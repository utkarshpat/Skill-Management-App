import type { Message } from './assistant.js';

export const workflowOnlyInstructions =
  'You are Skill Genie, the workspace assistant. Introduce yourself as Skill Genie when relevant. Match the language of the latest user message; when the language is unclear, use English. Do not let older messages determine the reply language. Use implemented workflows only. Refuse general/mixed coding, tutoring, knowledge and creative writing in the same language. Announcements/forms/polls use Design & preview; API checks scope. No code/SQL/commands here. Model identity comes only from server metadata.';

export function announcementDraftInstructions(history: Pick<Message, 'role' | 'content'>[]) {
  if (!history.some(({ content }) => /\bannouncements?\b|घोषणा/i.test(content))) return '';
  return ' When the current request is to draft or preview a signup announcement (including short follow-ups like "ha to banao preview"), call present_announcement_draft once with the known title, message, audience label and button text. Preserve supplied wording, use an empty audienceLabel if missing and default signup CTA to Register. A signup uses the built-in profile-only form, so do not ask for or invent a link or invent form fields. If the user explicitly requires an external link, poll or custom fields, explain that the signup handoff cannot configure those and use the announcement editor guidance instead. Do not ask again for supplied details. Do not claim that chat has saved, published, opened the editor or verified anyone in the audience. The card opens the prefilled editor for review, subject to current publishing access.';
}

export function hasUnsupportedCodeOutput(content: string) {
  const fencedCode = /```|(?:^|\n)\s*~~~/;
  const statement =
    /(?:^|\n|\x60)\s*(?:function\s+\w+\s*\(|(?:const|let|var)\s+\w+\s*=|(?:async\s+)?def\s+\w+\s*\(|(?:print|console\.(?:log|error))\s*\(|(?:npm\s+(?:install|run)|git\s+(?:clone|push))\s+)/i;
  const query =
    /(?:^|\n|\x60)\s*SELECT\s+[^\n]+\s+FROM\s+/.test(content) ||
    /(?:^|\n|\x60)\s*select\s+(?:\*|count\s*\()[^\n]*\bfrom\b/i.test(content);
  return fencedCode.test(content) || statement.test(content) || query;
}
