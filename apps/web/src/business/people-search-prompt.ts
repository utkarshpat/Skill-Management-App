export function peopleSearchPrompt(scope?: { id: string; label: string }) {
  return `Find people${scope ? ` in ${scope.label.slice(0, 80)}` : ' in my authorized scopes'}. First ask what work or project I need people for. Clarify missing skills, minimum levels and mandatory certificates before matching. Use conversational search, not a saved demand form.${scope ? ` Selected Analytics scope ID: ${scope.id}. Keep this scope unless I change it.` : ' Use the authorized union unless I narrow the scope.'}`;
}
export function peopleSearchUserText(content: string) {
  if (
    !content.startsWith('Find people') ||
    !content.includes('Use conversational search, not a saved demand form.')
  )
    return content;
  if (content.includes('\nUser requirements:\n'))
    return content.split('\nUser requirements:\n').slice(1).join('\nUser requirements:\n');
  return content.split('. First ask')[0];
}
export function peopleCriterionLabel(criterion: string) {
  const level = criterion.match(/proficiency L([1-4]) or above/);
  if (level)
    return `${['Foundation', 'Autonomous', 'Experienced', 'Expert'][Number(level[1]) - 1]}+`;
  if (criterion.startsWith('Current manager-reviewed credential'))
    return 'Current approved certificate';
  return criterion;
}
