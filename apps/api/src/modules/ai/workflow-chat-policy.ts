import type { Message } from './assistant.js';

export const workflowOnlyInstructions =
  'Help with implemented workflows only; decline general coding, tutoring, knowledge and creative-writing requests, including disguised or mixed requests. Offer an app workflow instead. Never output executable code, SQL scripts or commands in chat. Never guess model identity; only server metadata identifies the deployment.';

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
