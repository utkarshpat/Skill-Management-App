/** Translate legacy SQL validation copy, never stored records or authorization kinds. */
export function organizationValidationMessage(message: string) {
  return message
    .replace(/\ba (?=(?:department|team)\b)/gi, article => (article === 'A ' ? 'An ' : 'an '))
    .replace(/\bdepartments\b/gi, 'accounts/clients')
    .replace(/\bdepartment\b/gi, 'account/client')
    .replace(/\bteams\b/gi, 'organizational projects')
    .replace(/\bteam\b/gi, 'organizational project');
}
