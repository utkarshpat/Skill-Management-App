import { can, workspaceFor, type LocalAccessState, type LocalPerson } from '../access/index.js';

// Uses the same effective capability calculation as navigation. Labels never grant access.
export function assistantCapabilities(state:LocalAccessState, person:LocalPerson) {
  const workspace=workspaceFor(state,person), capabilities=workspace.capabilities;
  const pages=[{label:'Dashboard',url:'/workspace'}];
  if(capabilities.ownProfile)pages.push({label:'My profile',url:'/profile'});
  if(capabilities.ownSkills)pages.push({label:'My skills',url:'/my-skills'});
  if(capabilities.reviewSkills)pages.push({label:'Skill reviews',url:'/skill-reviews'});
  if(capabilities.catalogue)pages.push({label:'Skill catalogue',url:'/skills'});
  if(capabilities.administration){
    pages.push({label:'Administration dashboard',url:'/access?view=overview'},{label:'Roles & permissions',url:'/access?view=roles'});
    if(can(state,person,'users.manage'))pages.push({label:'People',url:'/access?view=people'},{label:'Organization',url:'/access?view=organization'},{label:'Role assignments',url:'/access?view=assignments'});
    if(can(state,person,'audit.view'))pages.push({label:'Activity log',url:'/access?view=audit'});
  }
  const guidance=[{action:'View own profile',url:'/profile',steps:['Open My profile.','Review your profile and assigned workspace information.']}];
  if(capabilities.ownSkills)guidance.push({action:'View own skill drafts',url:'/my-skills',steps:['Open My skills.','Review your claim status and manager feedback. Drafts are unverified; approved entries are manager-reviewed claims.']});
  if(capabilities.claimSkills)guidance.push({action:'Add or edit an own skill draft',url:'/my-skills',steps:['Open My skills and choose Add skill, or edit an existing draft.','Choose a published skill and its proficiency level.','Describe your experience, project contributions and evidence references; an AI draft can prefill the description for your review.','Review and Save draft, then choose Submit for review and confirm. Your current reporting manager must have review permission. Saving alone does not submit or verify the skill.']});
  if(capabilities.reviewSkills)guidance.push({action:'Review assigned skill submissions',url:'/skill-reviews',steps:['Open Skill reviews to see pending submissions assigned to you from current direct reports.','Review proficiency criteria, experience, projects and evidence.','Choose Approve, Request changes or Reject, enter feedback, and confirm the decision.','You cannot review your own claim or a claim outside your assignment. Learning quizzes do not verify a claim.']});
  if(capabilities.catalogue)guidance.push({action:'Browse published skills',url:'/skills',steps:['Open Skill catalogue.','Search by skill or category.','Read the proficiency criteria before choosing a level.']});
  if(capabilities.manageCatalogue)guidance.push({action:'Create or edit a catalogue skill',url:'/skills',steps:['Open Skill catalogue and choose New skill, or open an existing skill.','Enter the skill details and define proficiency levels.','Review publication requirements and Save skill.']});
  if(capabilities.administration){
    guidance.push({action:'Design permission sets',url:'/access?view=roles',steps:['Open Roles & permissions.','Create or edit a role.','Choose permission categories, grants and scopes.','Review and Save; a role label itself gives no access.']});
    if(can(state,person,'users.manage'))guidance.push({action:'Assign people access',url:'/access?view=assignments',steps:['Open Role assignments.','Select the person and role checkboxes.','Review changes and Save assignments.','Use People to amend individual permission overrides.']},{action:'Maintain reporting structure',url:'/access?view=organization',steps:['Open Organization.','Select the person or tree node and Edit.','Choose the actual reporting manager and organizational placement.','Review and Save; reporting levels follow person-to-person relationships.']});
  }
  return {pages,guidance,canDraftOwnSkill:capabilities.claimSkills,canManageCatalogue:capabilities.manageCatalogue,
    canManagePeople:capabilities.administration&&can(state,person,'users.manage'),canManagePermissions:capabilities.administration,
    learningPractice:'Informal previews only; learning history and scheduling are not implemented.',
    pendingWorkflows:workspace.upcoming.map(item=>({label:item.label,implemented:false})),assistantWrites:false};
}

export function capabilityGreeting(context:ReturnType<typeof assistantCapabilities>) {
  const items=context.pages.map(page=>`- ${page.label}`);
  if(context.canDraftOwnSkill)items.push('- Draft your own skill description for review and saving in My skills');
  items.push('- Draft learning tasks or create a practice quiz (choose 1–20 questions)');
  return `Hello! Based on your current access, I can help you with:\n\n${items.join('\n')}\n\nI can guide you through permitted pages and prepare drafts. Changes must be reviewed and saved in the app; learning tasks and tests are previews only.`;
}
