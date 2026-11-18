import type { Message } from './assistant.js';

export const workflowOnlyInstructions =
  'Use implemented workflows only. Refuse general/mixed coding, tutoring, knowledge and creative writing. Announcements/forms/polls: use Design & preview; API checks scope. No code/SQL/commands here. Model identity: server metadata only.';

const redirect =
  'Main sirf is Skill Management app ke workflows mein madad kar sakta hoon: skills/certificates, learning plans, reviews, requests aur access. General coding ke liye code generate nahi kar sakta. App mein kya karna hai?';

/** Bounded, deterministic shortcuts avoid spending model tokens on common off-scope requests.
 * This is not a complete semantic classifier; the provider still receives the scope policy.
 */
export function workflowChatShortcut(
  history: Pick<Message, 'role' | 'content'>[],
  provider: { name: string; deployment?: string },
) {
  const text = history.at(-1)?.content.normalize('NFKC').toLowerCase() ?? '';
  if (
    /\b(?:which|what)\b.{0,30}\b(?:ai )?model\b|\b(?:konsa|kaunsa|kaun sa|kis)\b.{0,35}\bmodel\b|कौन.{0,20}मॉडल|किस.{0,20}मॉडल/.test(
      text,
    )
  ) {
    // A deployment may be an alias, so do not claim it proves the underlying model version.
    return provider.deployment
      ? `Configured AI provider: ${provider.name}. Deployment: ${provider.deployment}. Yeh server-configured deployment name hai.`
      : 'Exact model/deployment metadata server se available nahi hai; main model ka naam guess nahi karunga.';
  }
  const request = text
    .replace(/\b(employee|access|error|status|response)\s+code\b/g, '$1 identifier')
    .replace(/(कर्मचारी|एक्सेस|त्रुटि|एरर|स्टेटस|स्थिति)\s*कोड/g, '$1 पहचान');
  const codeRequest =
    /\b(?:factorial|fibonacci|leetcode|competitive programming)\b/.test(request) ||
    /\b(?:write|generate|give|provide|create|implement|solve|debug|fix|likh|likho|banao|bana|do|de|dena|chahiye)\b[\s\S]{0,160}\b(?:code|script|program|function|algorithm)\b/.test(
      request,
    ) ||
    /\b(?:code|script|program|function|algorithm)\b[\s\S]{0,100}\b(?:do|de|dena|likh|likho|banao|chahiye)\b/.test(
      request,
    ) ||
    /(?:कोड|स्क्रिप्ट|प्रोग्राम).{0,60}(?:दो|दीजिए|लिख|बना)|(?:लिख|बना).{0,60}(?:कोड|स्क्रिप्ट|प्रोग्राम)/.test(
      request,
    );
  if (
    !codeRequest &&
    /\b(?:announcements?|announcememt|announcemnt|annoucement)\b|घोषणा/.test(request)
  )
    return 'Haan, app mein announcement banane mein madad milti hai. Announcements kholo. Agar New announcement aapke current access mein available hai, pehle Basic details mein message, schedule, allowed audience aur form/poll configure karo. Agle Design & preview step mein AI chat se HTML/CSS design aur refinements kar sakte ho. Preview mein try karke audience review karo; publish aapke eligible scope mein hi hoga. Main general chat se publish ya permissions change nahi karta.';
  return codeRequest ? redirect : undefined;
}

export function workflowChatReply(content: string) {
  // A defensive delivery guard, not an authorization mechanism. Quizzes and
  // reviewed workflow artifacts are validated through their existing paths.
  return /```|(?:^|\n)\s*(?:function\s+\w+\s*\(|(?:const|let|var)\s+\w+\s*=|SELECT\s+.+\s+FROM\s+)/m.test(
    content,
  )
    ? redirect
    : content;
}
