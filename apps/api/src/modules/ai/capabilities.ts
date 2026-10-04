import { can, workspaceFor, type LocalAccessState, type LocalPerson } from '../access/index.js';

// Uses the same effective capability calculation as navigation. Labels never grant access.
export function assistantCapabilities(state:LocalAccessState, person:LocalPerson) {
  const workspace=workspaceFor(state,person), capabilities=workspace.capabilities;
  const pages=[{label:'Dashboard',url:'/workspace'}];
  if(capabilities.ownProfile)pages.push({label:'My profile',url:'/profile'});
  if(capabilities.ownSkills)pages.push({label:'My skills',url:'/my-skills'});
  if(capabilities.requests)pages.push({label:'Requests',url:'/requests'});
  if(capabilities.learning)pages.push({label:'Learn & Grow',url:'/learning'});
  if(capabilities.reviewSkills)pages.push({label:'Skill reviews',url:'/skill-reviews'});
  if(capabilities.catalogue)pages.push({label:'Skill catalogue',url:'/skills'});
  if(capabilities.administration){
    pages.push({label:'Administration dashboard',url:'/access?view=overview'},{label:'Roles & permissions',url:'/access?view=roles'});
    if(can(state,person,'users.manage'))pages.push({label:'People',url:'/access?view=people'},{label:'Organization',url:'/access?view=organization'},{label:'Role assignments',url:'/access?view=assignments'});
    if(can(state,person,'audit.view'))pages.push({label:'Activity log',url:'/access?view=audit'});
  }
  const guidance:{action:string;url:string;steps:string[]}[]=[];
  if(capabilities.ownProfile)guidance.push({action:'View own profile',url:'/profile',steps:['Open My profile.','Review your profile and assigned workspace information.']});
  const canDraftRequest=can(state,person,'request.create',true)&&can(state,person,'request.view',true),canDraftIncident=can(state,person,'incident.create',true)&&can(state,person,'incident.view',true);
  if(capabilities.requests)guidance.push({action:'Read requests, incidents, replies and recipient options',url:'/requests',steps:['Open Requests. My requests shows your submitted records; Assigned to me shows records addressed to you. Search and summary cards filter real records.','Open a record to read its activity. Comment requires the matching create and view permissions. Only the requester can cancel an active record. The current recipient can Start work with assign permission or Resolve an in-progress record with resolve permission. The requester or current recipient can Reassign an active record with assign permission. Each action requires a reviewed note; reassign uses explicit name search and removes the former recipient from access. Approval and evidence uploads remain unavailable. AI can draft replies and resolution notes inside the action form; final confirmation performs the action.']});
  if(canDraftRequest||canDraftIncident)guidance.push({action:'Draft and submit a request or report an incident',url:'/requests',steps:['AI can prepare a request_draft or incident_draft. Review request draft opens the existing popup in place; do not ask the user to copy/paste.','Choose the category, review the subject and description, search a recipient by name and select their card. Do not invent who is an administrator or promise automatic routing.','Review & send shows the final details. Only explicit Submit persists the record and notifies its recipient.']});
  if(capabilities.ownSkills)guidance.push({action:'View own skill drafts',url:'/my-skills',steps:['Open My skills.','Review your claim status and manager feedback. Drafts are unverified; approved entries are manager-reviewed claims.']});
  if(capabilities.claimSkills)guidance.push({action:'Add or edit an own skill draft',url:'/my-skills',steps:['Open My skills and choose Add skill, or edit an existing draft.','Choose a published skill and its proficiency level.','Describe your experience, project contributions and evidence references; an AI draft can prefill the description for your review.','Review and Save draft, then choose Submit for review and confirm. Your current reporting manager must have review permission. Saving alone does not submit or verify the skill.']});
  if(capabilities.reviewSkills)guidance.push({action:'Review assigned skill submissions',url:'/skill-reviews',steps:['Open Skill reviews to see pending submissions assigned to you from current direct reports.','Review proficiency criteria, experience, projects and evidence.','Choose Approve, Request changes or Reject, enter feedback, and confirm the decision.','You cannot review your own claim or a claim outside your assignment. Learning quizzes do not verify a claim.']});
  if(capabilities.learning)guidance.push({action:'Track personal learning',url:'/learning',steps:['Open Learn & Grow. Today shows scheduled tasks; Calendar shows dated tasks; Backlog holds missed tasks; Learning paths shows week-wise progress; Goals shows linked skills; Recommendations generates AI suggestions on demand.','With learning.manage, choose New plan, enter your goal, daily available time and one task per line; optionally link a published skill and choose a focus; review before creating. AI planner asks for a goal, daily minutes, cycle length and starting experience; it creates an editable roadmap and accepts refinement feedback. Review & schedule opens the creation wizard with those dates and minutes retained; only explicit Create plan saves it.','Log completion records actual minutes and notes. Reschedule individual tasks explicitly. For an active plan with overdue tasks, Recover plan under Backlog or Learning paths previews all pending dates, daily budget and target date; only Confirm recovery applies the schedule. Completed records and saved practice remain unchanged. Optional AI guidance cannot apply or alter dates. Pause, Resume and Archive are available under Learning paths.','Streaks count consecutive actual completion days in your browser timezone. Learning does not verify a skill. Open a task with Start/Continue: Session saves notes/time drafts, Resources saves your links, Practice creates a task-linked quiz, and History shows submitted scores and explanations. These practice attempts are stored; chat-only quiz cards are unsaved previews.']});
  if(capabilities.catalogue)guidance.push({action:'Browse published skills',url:'/skills',steps:['Open Skill catalogue.','Search by skill or category.','Read the proficiency criteria before choosing a level.']});
  if(capabilities.manageCatalogue)guidance.push({action:'Create or edit a catalogue skill',url:'/skills',steps:['Open Skill catalogue and choose New skill, or open an existing skill.','Enter the skill details and define proficiency levels.','Review publication requirements and Save skill.']});
  if(capabilities.administration){
    guidance.push({action:'Design permission sets',url:'/access?view=roles',steps:['Open Roles & permissions.','Create or edit a role.','Choose permission categories, grants and scopes.','Review and Save; a role label itself gives no access.']});
    if(can(state,person,'users.manage'))guidance.push({action:'Assign people access',url:'/access?view=assignments',steps:['Open Role assignments.','Select the person and role checkboxes.','Review changes and Save assignments.','Use People to amend individual permission overrides.']},{action:'Maintain reporting structure',url:'/access?view=organization',steps:['Open Organization.','Select the person or tree node and Edit.','Choose the actual reporting manager and organizational placement.','Review and Save; reporting levels follow person-to-person relationships.']});
  }
  return {pages,guidance,canDraftOwnSkill:capabilities.claimSkills,canManageCatalogue:capabilities.manageCatalogue,
    canDraftRequest,canDraftIncident,canManageLearning:can(state,person,'learning.manage',true),
    canManagePeople:capabilities.administration&&can(state,person,'users.manage'),canManagePermissions:capabilities.administration,
    learningPractice:'Personal plans, calendar and completion logs are available with learning permissions. Task-linked AI practice quizzes save attempts and explanations in learning. They do not verify skills or complete tasks; chat-only quizzes remain unsaved previews.',
    pendingWorkflows:workspace.upcoming.filter(item=>!item.implemented).map(item=>({label:item.label,implemented:false})),assistantWrites:false};
}

export function capabilityGreeting(context:ReturnType<typeof assistantCapabilities>) {
  const items=context.pages.map(page=>`- ${page.label}`);
  if(context.canDraftOwnSkill)items.push('- Draft your own skill description for review and saving in My skills');
  items.push('- Draft learning tasks or create a practice quiz (choose 1–20 questions)');
  return `Hello! Based on your current access, I can help you with:\n\n${items.join('\n')}\n\nI can guide you through permitted pages and prepare drafts. Changes must be reviewed and saved in the app; learning plans are saved in Learn & Grow. Task-linked practice attempts are stored in History; quizzes shown only in chat remain previews.`;
}
