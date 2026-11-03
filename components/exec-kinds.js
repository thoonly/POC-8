// components/exec-kinds.js — Execution node Kinds (source: execution-node-kinds-catalogue.md, draft 2026-10-23).
//
//   Prompt → Kind (what action, which steps) × Item type (how items look) × Modifiers (depth, recurrence, people,
//   external action, connector, sensitivity, collaboration) → Custom Kind (K-00) when nothing fits.
//
// The UI stays the same: every Kind runs on one of the step engines the node already has —
//   decide (What matters → Options → Compare → Decide → Result) · find (Questions → Findings → Result)
//   define (Write down → Result) · gather (Categories → Collect → Result) · design (design-mode.js)
// A Kind only renames those steps, tells the AI what goes in each one (exCtx), sets the item type and the modifiers,
// and adds an approval gate before Complete when the work acts outside CollabiQ, is regulated, or is Deep.
// "Running as <Kind> · Change" in the node header lets the user switch Kind (it starts the node over).
// Approval nodes (planned approach "approve") keep their own view.
//
// Loaded after design-mode.js; it wraps the shared functions (same pattern as design-mode.js / complexity-v2.js).
(function(){
  'use strict';
  if(typeof exRsSteps !== 'function' || typeof exCtx !== 'function') return;
  const E = s => ipE(s == null ? '' : String(s));

  const FAMILIES = { A: 'Understand', B: 'Choose', C: 'Create', D: 'Plan', E: 'Act & coordinate', G: 'Assemble', F: 'Fallback' };
  // id, family, label, engine, trigger words, catalogue steps, step labels (engine key → label), what goes in each step,
  // default fields (define / gather), default item type, result, modifier defaults.
  const K = (id, fam, label, engine, trigger, steps, labels, guide, fields, item, result, mods) =>
    ({ id, fam, label, engine, trigger, steps, labels: labels || {}, guide: guide || '', fields: fields || [], item: item || '', result: result || '', mods: mods || {} });
  const KINDS = [
    // ---------- A — Understand ----------
    K('K-A1', 'A', 'Find out', 'find', 'What is…, How does…, Is it true that…, What are the rules for…', 'Questions → Findings → Confidence per finding → Answer',
      { result: 'Answer' }, 'Questions are what must be answered. Each finding says how sure it is: sources agree, sources conflict, or a single source.', [], 'Source', 'Answer + open questions'),
    K('K-A2', 'A', 'Literature review', 'find', 'Review the research on…, What do studies say…', 'Scope & question → Search terms → Screen sources → Extract → Synthesize → Gaps in the evidence',
      { questions: 'Scope & search', findings: 'Screened evidence', result: 'Evidence summary' }, 'Questions are the review questions and the search terms. Findings are screened sources: keep or drop with a reason, then what each one says. The result ends with the gaps in the evidence and a reading list.', [], 'Source / paper', 'Evidence summary + reading list', { depth: 'deep' }),
    K('K-A3', 'A', 'Summarize', 'find', 'Summarize this, TL;DR, Key points of…', 'Source(s) → Length & audience → Key points → Summary → Check against source',
      { questions: 'Key points', findings: 'From the source', result: 'Summary' }, 'One source or a small set. Questions are the points the summary must cover for this audience and length. Findings come from the source only — nothing invented; each point is checked against the source.', [], 'Source / document', 'Summary', { depth: 'quick' }),
    K('K-A4', 'A', 'Synthesize', 'find', 'What did the interviews say, Common themes across…', 'Sources → Extract points & quotes → Group into themes → Theme strength → Insights',
      { questions: 'Themes', findings: 'Evidence per theme', result: 'Insights' }, 'Many sources → patterns. Questions are candidate themes. Findings are the quotes and points that back each theme; say how many sources back it (theme strength).', [], 'Theme', 'Themes with evidence'),
    K('K-A5', 'A', 'Extract', 'define', 'Pull the amounts from these invoices, List all dates in the contract', 'Documents → Fields to extract → Extract → Check low-confidence values → Table',
      { draft: 'Extracted rows', result: 'Table' }, 'Each item is one record found in the documents (one invoice, one clause, one date). The fields are the fields to extract. Mark a low-confidence value with "(check)".', [], 'Record / row', 'Structured table'),
    K('K-A6', 'A', 'Analyze data', 'find', 'Why did sales drop, Analyze this spreadsheet', 'Question → Data → Clean (logged) → Calculate → Charts → Insights',
      { questions: 'Questions for the data', findings: 'Calculations & insights', result: 'Insight report' }, 'Questions are what the data must answer. Findings are calculations, each tied to a number or a chart. Log any cleaning. With no data in the inputs, say which data is needed and mark figures as assumed.', [], 'Metric', 'Insight report', { connector: 'data file or BI' }),
    K('K-A7', 'A', 'Diagnose', 'find', 'Why is X happening, What is causing…, Debug…', 'Symptom → Possible causes → Evidence per cause → Root cause → Fixes',
      { questions: 'Possible causes', findings: 'Evidence per cause', result: 'Root cause & fixes' }, 'Questions are the possible causes of the symptom. Findings are evidence for or against each cause. The result names the root cause and a fix list.', [], 'Cause', 'Root cause + fix list'),
    K('K-A8', 'A', 'Situation analysis', 'define', 'SWOT, PESTEL, Analyze our market position', 'Scope → Lens → Fill each box (sourced) → So what?',
      { draft: 'Framework board', result: 'Implications' }, 'The framework is the lens (SWOT, PESTEL, Five Forces, Value chain, Jobs-to-be-done or custom). Each item is one sourced fact in one box of the lens. The result says what it means ("so what?").', ['Box in the lens', 'Source or assumed', 'So what?'], 'Fact', 'Framework board + implications'),
    K('K-A9', 'A', 'Fact-check', 'find', 'Is this claim true, Verify these numbers', 'Claims → Sources per claim → Verdict → Corrected text',
      { questions: 'Claims', findings: 'Sources per claim', result: 'Verdict table' }, 'Questions are the claims, word for word. Findings are sources per claim; the note gives the verdict — true, partly true, false or can\'t verify. The result adds corrected text.', [], 'Claim', 'Verdict table'),
    K('K-A10', 'A', 'Monitor', 'gather', 'Keep an eye on…, Weekly competitor news, Alert me when…', 'Watch list → Signals to track → Threshold → Digest',
      { interests: 'Watch list', collect: 'Signals', result: 'Digest' }, 'Categories are what to watch (companies, topics, sources). Items are signals — what changed, with its date. Rules are the threshold for what counts as news. Each run is a dated digest: what changed since the last run.', [], 'Signal', 'Digest per run', { recurrence: 'weekly' }),
    K('K-A11', 'A', 'Learn', 'find', 'Teach me…, I need to understand X by Friday', 'What you already know → Learning path → Explain in parts → Check understanding → Cheat sheet',
      { questions: 'Learning path', findings: 'Explanations', result: 'Cheat sheet' }, 'Questions are the parts of the learning path, in order, starting from what the user already knows. Findings explain each part simply. The result is a cheat sheet with a short self-check quiz.', [], 'Concept', 'Learning notes + cheat sheet'),
    K('K-A12', 'A', 'Evaluate results', 'define', 'How did the campaign do, Budget vs actual, Post-mortem', 'Goals/targets → Actuals → Variance → Reasons → Lessons & actions',
      { draft: 'Targets vs actuals', result: 'Results review' }, 'Each item is one goal or metric. The result ends with lessons and actions. Covers variance analysis, retros and post-mortems.', ['Target', 'Actual', 'Variance & reason'], 'Metric', 'Results review'),
    // ---------- B — Choose ----------
    K('K-B1', 'B', 'Decide', 'decide', 'Which… should we…, Help me choose', 'What matters → Options → Compare (check the data, scores in words) → Decide',
      {}, 'The node ends in one pick (or the number the Definition of done asks for).', [], '', 'Decision + scores + why'),
    K('K-B2', 'B', 'Gather', 'gather', 'Find…, List…, Collect…', 'Categories → Collect → Pick (each item checked against your rules)',
      { interests: 'Categories' }, 'Items are found on public pages and checked against the rules.', [], '', 'Shortlist'),
    K('K-B3', 'B', 'Benchmark', 'gather', 'Compare competitors, How do others do X', 'Subjects → Dimensions → Fill the matrix (each cell sourced) → Patterns & gaps → Takeaways',
      { interests: 'Subjects', collect: 'Fill the matrix', result: 'Matrix & takeaways' }, 'Items are the subjects compared. The fields are the dimensions — every subject gets the same facts, each one sourced. No forced decision: the result shows patterns, gaps and takeaways.', [], 'Company', 'Matrix + positioning map'),
    K('K-B4', 'B', 'Prioritize', 'decide', 'What should we do first, Rank these', 'Items → Method → Score → Rank & cut line → "Not now" list',
      { criteria: 'Method', options: 'Items to rank', compare: 'Score', decide: 'Rank & cut line', result: 'Ranked list' }, 'Criteria are the scoring method\'s factors (Impact / Effort, RICE, MoSCoW, weighted or custom). Options are the items to rank. Pick several — the ones above the cut line; the rest is the "Not now" list, each with a reason.', [], 'Task / feature / idea', 'Ranked list', { pickMany: true }),
    K('K-B5', 'B', 'Review', 'define', 'Check this against…, Proofread, Audit', 'Rules → Check each item → Issues by severity → Suggested fixes',
      { draft: 'Issues', result: 'Issue list' }, 'The rules are the checklist from the inputs or the user. Each item is one issue found against one rule. Covers proofreading, compliance checks, code review and design critique.', ['Severity (high / medium / low)', 'Suggested fix'], 'Issue', 'Issue list + revised doc'),
    K('K-B6', 'B', 'Assess risk', 'define', 'What could go wrong, Risk register', 'Risks → Likelihood × impact → Mitigation → Owner → Watch signals',
      { draft: 'Risks', result: 'Risk register' }, 'Each item is one risk.', ['Likelihood × impact', 'Mitigation', 'Owner'], 'Risk', 'Risk register'),
    K('K-B7', 'B', 'Test a hypothesis', 'define', 'Will users pay for…, A/B test, Validate the idea', 'Assumption → How to test → Pass/fail rule (set before running) → Run → Result → Next step',
      { draft: 'Hypotheses & tests', result: 'Test plan' }, 'Each item is one assumption to test. The pass/fail rule is set before running.', ['How to test', 'Pass / fail rule'], 'Hypothesis', 'Test result', { people: 'waiting' }),
    K('K-B8', 'B', 'Select people', 'decide', 'Shortlist candidates, Pick a vendor contact, Who should review', 'Role & must-haves → Candidates → Check against must-haves → Score → Pick',
      { criteria: 'Must-haves', options: 'Candidates', compare: 'Check & score', decide: 'Pick' }, 'Only work-relevant facts with a source. No photos of people. Minimum personal data.', [], 'Person', 'Shortlist / pick', { sensitivity: 'confidential' }),
    // ---------- C — Create ----------
    K('K-C1', 'C', 'Ideate', 'define', 'Ideas for…, Brainstorm, Name options', 'Brief & constraints → Generate (go wide) → Group → Shortlist (vote) → Develop top 3',
      { draft: 'Ideas', result: 'Developed ideas' }, 'Go wide first — varied ideas, not variants of one. The user keeps the best; the result develops the top 3.', ['Why it could work'], 'Idea', 'Developed ideas'),
    K('K-C2', 'C', 'Write', 'define', 'Draft…, Write an email / post / report / proposal', 'Audience & goal → Key messages → Outline → Draft → Check → Final',
      { draft: 'Outline', result: 'Final text' }, 'Each item is one section or key message of the text, in reading order, for the audience and goal. The result is the finished text — checked for length, tone, and facts against the inputs.', ['What this part says'], 'Text option', 'Final text'),
    K('K-C3', 'C', 'Define', 'define', 'Define roles, Write the requirements, Glossary', 'Fields → Draft (fields per item) → Check consistency',
      {}, 'Covers specs, user stories, job descriptions and policies. Check overlaps and anything missing.', [], 'Requirement / definition', 'Definition list'),
    K('K-C4', 'C', 'Design', 'design', 'Design the flow / system / brand', 'Research documents → Decide what must be settled → Borrow ideas → Your logic → Logic document',
      {}, 'Visual item types are drawn, not fetched.', [], 'Layout / palette / type', 'Logic document'),
    K('K-C5', 'C', 'Model / Forecast', 'define', 'Forecast revenue, Build a financial model, Projection', 'Question → Assumptions → Model structure → Calculate → Sensitivity → Range',
      { draft: 'Assumptions', result: 'Model & range' }, 'Each item is one driver or assumption. The result shows the formulas, what moves the result most (sensitivity), and a low / expected / high range — never only one number.', ['Value', 'Source or assumed'], 'Assumption', 'Model + range', { depth: 'deep' }),
    K('K-C6', 'C', 'Estimate', 'define', 'Budget for…, How much will it cost, How long will it take', 'Line items → Unit cost / effort → Quantities → Totals (low / expected / high) → Assumptions',
      { draft: 'Line items', result: 'Estimate' }, 'Each item is one line item. The result totals them as low / expected / high and lists the assumptions.', ['Unit cost × quantity', 'Total (low / expected / high)', 'Source or assumed'], 'Line item', 'Estimate with range'),
    K('K-C7', 'C', 'Calculate', 'define', 'Calculate tax / ROI / loan payment / conversion', 'Inputs → Formula (shown) → Result → Sanity check',
      { draft: 'Inputs', result: 'Result & working' }, 'Items are the inputs to the formula. The result shows the formula, the number and a sanity check.', ['Value', 'Source or assumed'], 'Metric', 'Number + working', { depth: 'quick' }),
    K('K-C8', 'C', 'Present', 'define', 'Make a deck, Turn this into slides, Pitch', 'Audience & goal → Storyline → Visuals → Slides → Rehearsal notes',
      { draft: 'Storyline', result: 'Presentation' }, 'Each item is one slide with one message, in order. The result adds rehearsal notes; "Turn this result into → Presentation" makes the slides.', ['The one message', 'Visual'], 'Slide', 'Presentation'),
    K('K-C9', 'C', 'Visualize', 'define', 'Chart this, Draw a diagram, Org chart', 'Data or concept → Best form → Draft → Labels & check',
      { draft: 'Elements', result: 'Visual' }, 'Pick the best form first (chart, diagram, map or timeline). Each item is one element of the visual.', ['What it shows', 'Form'], 'Chart / diagram', 'Visual'),
    K('K-C10', 'C', 'Translate / Localize', 'define', 'Translate to Thai, Localize for Japan', 'Source → Glossary & tone → Translate → Check',
      { draft: 'Glossary & tone', result: 'Translation' }, 'Items are the glossary terms and tone rules. The result is the translated text, checked for meaning, tone and local conventions. Thai ↔ English first.', ['Translation', 'Tone or local note'], 'Text', 'Translated text', { depth: 'quick' }),
    K('K-C11', 'C', 'Transform', 'define', 'Convert to table, Reformat, Clean this list, Merge these files', 'Source → Target format → Mapping → Convert → Check',
      { draft: 'Mapping', result: 'Converted output' }, 'Each item is one mapping rule. The result checks nothing was lost.', ['From (source)', 'To (target)'], 'Record', 'Converted output', { depth: 'quick' }),
    K('K-C12', 'C', 'Organize', 'define', 'Structure our docs, Categorize, Tag these', 'Items → Proposed categories → Assign → Edge cases → Final structure',
      { draft: 'Categories', result: 'Final structure' }, 'Each item is one category of the structure.', ['What goes in it', 'Edge cases'], 'Any', 'Taxonomy / folder tree'),
    K('K-C13', 'C', 'Map a process', 'define', 'Map our onboarding process, As-is / to-be', 'Actors → Steps (as-is) → Hand-offs & delays → Pain points → To-be process',
      { draft: 'Process steps', result: 'Process map' }, 'Items are the as-is steps, in order. The result adds the to-be process.', ['Who (actor)', 'Hand-off or delay', 'Pain point'], 'Process step', 'Process map'),
    // Not in the catalogue draft: added after the expert coverage test (regex and SQL requests fell to Custom).
    K('K-C14', 'C', 'Write code / query', 'define', 'Write a regex / SQL / script, Fix this formula', 'Goal & inputs → Code → How to check it → Final',
      { draft: 'Code parts', result: 'Code & how to check it' }, 'Each item is one piece of code (a query, a pattern, a function) with what it does and how to check it on sample inputs. Code is shown, never run.', ['What it does', 'Code', 'How to check it'], 'Code / technical option', 'Code + test cases'),
    // ---------- D — Plan ----------
    K('K-D1', 'D', 'Plan', 'define', 'Plan the launch, Project plan', 'Goal & deadline → Tasks → Order & dependencies → Owners & dates → Timeline → Risks to the plan',
      { draft: 'Tasks', result: 'Timeline' }, 'Each item is one task. The result is a timeline and ends with the risks to the plan.', ['Owner', 'Date', 'Depends on'], 'Task', 'Timeline + task list'),
    K('K-D2', 'D', 'Set goals', 'define', 'OKRs, KPIs for Q1, Targets', 'Ambition → Objectives → Measurable key results → Alignment check → Owners',
      { draft: 'Objectives', result: 'Goal set' }, 'Each item is one objective.', ['Measurable key result', 'Owner'], 'Goal', 'Goal set'),
    K('K-D3', 'D', 'Scenarios', 'define', 'What if…, Plan for uncertainty', 'Driving forces → Two key uncertainties → 2×2 scenarios → Implications → Early-warning signs',
      { draft: 'Scenarios', result: 'Scenario set' }, 'Name the two key uncertainties; the items are the four scenarios of their 2×2.', ['Implications', 'Early-warning sign'], 'Scenario', 'Scenario set'),
    K('K-D4', 'D', 'Strategic choices', 'define', 'Our strategy for…, Where should we compete', 'Where to play → How to win → What we need → What we stop doing',
      { draft: 'Choices', result: 'Strategy on a page' }, 'The items answer: where to play, how to win, what we need, what we stop doing.', ['Our answer', 'Why'], 'Choice', 'Strategy on a page'),
    K('K-D5', 'D', 'Stakeholder map', 'define', 'Who do we need on board, Change management', 'People/groups → Influence × interest → Current stance → Engagement plan',
      { draft: 'Stakeholders', result: 'Engagement plan' }, 'Each item is one person or group. Work-relevant facts only.', ['Influence × interest', 'Current stance', 'How to engage'], 'Person / group', 'Map + engagement plan', { sensitivity: 'confidential' }),
    K('K-D6', 'D', 'Research plan', 'define', 'Plan user interviews, Study design', 'Goals → Method → Who to recruit → Guide/script → Schedule',
      { draft: 'Plan parts', result: 'Research plan' }, 'Each item is one research goal or question.', ['Method', 'Who', 'When'], 'Question', 'Research plan'),
    K('K-D7', 'D', 'Survey', 'define', 'Make a survey, Collect feedback', 'Goal → Questions (bias check) → Audience → Send (gate) → Responses → Results by segment',
      { draft: 'Questions', result: 'Survey' }, 'Each item is one survey question, checked for bias.', ['Answer type', 'Bias check'], 'Question', 'Survey results', { external: 'send the survey', people: 'waiting' }),
    K('K-D8', 'D', 'Schedule', 'decide', 'Find a time, Book a meeting, Set up the calendar', 'People → Constraints → Slots → Invite (gate)',
      { criteria: 'Constraints', options: 'Time slots', decide: 'Pick a slot', result: 'Invite' }, 'Options are specific time slots (with time zone); criteria are who must attend and the constraints.', [], 'Time slot', 'Invite / calendar', { external: 'send the invite', connector: 'calendar' }),
    K('K-D9', 'D', 'Negotiation prep', 'define', 'Prepare for a salary / vendor negotiation', 'Your goal & walk-away point → Their likely position → Options to trade → Script & answers to pushback',
      { draft: 'Positions & trades', result: 'Negotiation brief' }, 'Include your goal and walk-away point, their likely position, and answers to pushback.', ['Ours / theirs', 'What we can trade'], 'Position', 'Negotiation brief'),
    K('K-D10', 'D', 'Meeting prep', 'define', 'Prepare for tomorrow\'s meeting', 'Purpose → Agenda → Pre-reads → Questions to ask → Desired outcome',
      { draft: 'Agenda', result: 'Agenda & brief' }, 'Each item is one agenda item.', ['Desired outcome', 'Pre-read or question'], 'Agenda item', 'Agenda + brief', { depth: 'quick' }),
    // ---------- E — Act & coordinate ----------
    K('K-E1', 'E', 'Triage', 'define', 'Sort my inbox, What should I do today', 'Items → Urgent / important → Do / Delegate / Schedule / Drop',
      { draft: 'Sorted items', result: 'Sorted list' }, 'Each item is one message or task.', ['Do / Delegate / Schedule / Drop', 'Why'], 'Message / task', 'Sorted list', { connector: 'email or tasks' }),
    K('K-E2', 'E', 'Reply', 'define', 'Reply to this, Answer the customer', 'Incoming message → What they want → Draft reply → Approve (gate)',
      { draft: 'What they want', result: 'Reply draft' }, 'Items are what the sender wants, one per point. The result is the reply draft.', ['How we answer'], 'Message', 'Sent reply', { depth: 'quick', external: 'send the reply' }),
    K('K-E3', 'E', 'Send', 'define', 'Send the result to…, Post to Slack', 'Recipients → Message per audience → Channel → Approve (gate) → Send',
      { draft: 'Recipients & message', result: 'Ready to send' }, 'Each item is one audience. "Let me help" may draft but never sends.', ['Message for this audience', 'Channel'], 'Message', 'Sent log', { external: 'send or post' }),
    K('K-E4', 'E', 'Delegate', 'define', 'Assign this to…, Hand off', 'Task → Owner → Brief → Due date → Follow-up check',
      { draft: 'Tasks to hand off', result: 'Assigned tasks' }, 'Each item is one task to hand off.', ['Owner', 'Due date', 'Brief'], 'Task', 'Assigned task', { people: 'waiting' }),
    K('K-E5', 'E', 'Follow up', 'define', 'Chase the overdue items, Remind people', 'Open items → Who owes what → Message → Send (gate) → Status',
      { draft: 'Open items', result: 'Follow-up log' }, 'Each item is one open item.', ['Who owes it', 'Message'], 'Task', 'Follow-up log', { external: 'send reminders', recurrence: 'weekly' }),
    K('K-E6', 'E', 'Meeting follow-up', 'define', 'Notes from the call, Action items', 'Notes/transcript → Decisions → Actions (owner, date) → Send (gate)',
      { draft: 'Decisions & actions', result: 'Minutes' }, 'Each item is one decision or action.', ['Owner', 'Date'], 'Decision / task', 'Minutes + actions', { external: 'send the minutes' }),
    K('K-E7', 'E', 'Status update', 'define', 'Weekly update, Report progress', 'Period → Done / doing / blocked → Key numbers → Send (gate)',
      { draft: 'Done / doing / blocked', result: 'Update' }, 'Each item is one piece of work with its status.', ['Status', 'Key number'], 'Task / metric', 'Update', { external: 'send the update', recurrence: 'weekly' }),
    K('K-E8', 'E', 'Update a record', 'define', 'Update the CRM, Change the ticket status', 'Find record → Change → Confirm (gate)',
      { draft: 'Changes', result: 'Updated record' }, 'Each item is one field change on the record.', ['Field', 'New value'], 'Record', 'Updated record', { depth: 'quick', external: 'update another system', connector: 'CRM or ticketing' }),
    K('K-E9', 'E', 'Fill in a form', 'define', 'Fill the grant application, Complete the vendor form', 'Form → Required fields → Pull answers from inputs → Missing items → Review → Submit (gate)',
      { draft: 'Form fields', result: 'Completed form' }, 'Each item is one form field. Answers come from the inputs; a missing one is asked from the user.', ['Answer', 'From (input or ask the user)'], 'Field', 'Completed form', { external: 'submit the form' }),
    K('K-E10', 'E', 'Request / Approve', 'define', 'Request budget, Purchase request, Approve the leave', 'What & why → Approver → Submit (gate) → Decision',
      { draft: 'Request', result: 'Request ready' }, 'Items are what is requested and why. Planned approval nodes keep their own view.', ['What & why', 'Approver'], 'Request', 'Approved / declined', { external: 'submit the request' }),
    K('K-E11', 'E', 'Reconcile', 'define', 'Match bank statement to invoices, Compare two lists', 'Source A & B → Match rules → Matched / unmatched → Explain differences → Adjustments',
      { draft: 'Matched / unmatched', result: 'Reconciliation report' }, 'Each item is one record pair or unmatched record.', ['Match status', 'Difference & reason'], 'Record', 'Reconciliation report', { connector: 'accounting' }),
    K('K-E12', 'E', 'Book / Buy', 'decide', 'Book the hotel, Order the furniture', 'Pick → Details → Price check → Confirm (gate) → Receipt',
      { decide: 'Pick to book', result: 'Booking details' }, 'Options are specific, bookable items. Payment is always gated; without a connector the result is booking instructions only.', [], 'Place / product', 'Booking / receipt', { external: 'book or pay' }),
    // ---------- F — Fallback ----------
    // ---------- G — Assemble (round 77: the last node of a planned workstream for big work) ----------
    K('K-G1', 'G', 'Assemble & decide', 'define', 'Only as the last node of a planned workstream: pull the nodes\' results into one deliverable', 'Inputs (every earlier node) → Decision points → Assembled deliverable',
      { draft: 'Decision points', result: 'Assembled deliverable' }, 'The inputs are every earlier node\'s result. Each item is ONE decision the reader must settle, drawn only from those results: the options, the recommendation and why, who decides and by when, and which node\'s result it rests on. A conflict or gap between two nodes is named as a decision or a risk, never filled in. The result then pulls every earlier node\'s result into one deliverable in reading order — the answer first, then the decisions, then each part, saying which node it comes from — with nothing new researched or invented.', ['Options', 'Recommendation and why', 'Who decides, by when', 'Rests on (node)'], 'Decision', 'Decision paper / pack'),
    K('K-00', 'F', 'Custom', 'find', 'Nothing fits, or the user wants their own steps', 'Goal → AI proposes steps (user edits) → Run steps → Result',
      { questions: 'Steps to run', findings: 'Step results', result: 'Result' }, 'No Kind fits. The questions are the steps you propose for this goal (the user edits them); the findings are each step\'s result. Physical-world work becomes a checklist of what a person must do.', [], 'Task', 'Whatever the goal defines')
  ];
  // Kinds whose work usually comes round again (catalogue §5: month-end close, weekly status, digests).
  const REPEATS = new Set(['K-A10', 'K-A12', 'K-E5', 'K-E7', 'K-E11']);
  const BY_ID = Object.fromEntries(KINDS.map(x => [x.id, x]));
  const DEFAULT_FOR = { decide: 'K-B1', find: 'K-A1', define: 'K-C3', gather: 'K-B2', design: 'K-C4' };

  // Item types (catalogue §3): visual slot · key facts · default criteria. Fetched visuals are never AI-generated.
  const ITEM_TYPES = [
    ['Place', 'photo + map pin (fetched)', 'price, distance to X, rating, capacity, availability'],
    ['Area', 'map outline', 'commute, average cost, safety / transport, climate'],
    ['Property (real estate)', 'floor plan or photos (fetched)', 'size, rent / price, lease term, facilities'],
    ['Route / trip', 'route line', 'times, duration, stops, price, baggage'],
    ['Product', 'product photo (fetched)', 'price, key specs, warranty, where to buy'],
    ['Event', 'calendar chip', 'date, time zone, location, cost'],
    ['Time slot', 'calendar chip', 'time zone, conflicts, who can attend'],
    ['Company', 'logo (fetched) + one-line positioning', 'pricing tier, target customer, size / funding, founded, HQ'],
    ['Software', 'logo + screenshot (fetched)', 'plans & prices, features, integrations, security certifications'],
    ['Vendor', 'logo (fetched)', 'price, lead time, MOQ, terms, references'],
    ['Person', 'initials avatar — never a photo', 'role, organization, relevant experience, source'],
    ['Investor / partner', 'logo (fetched)', 'focus, cheque size / stage, portfolio fit'],
    ['Group / segment', 'icon + size', 'size, needs, influence'],
    ['Colour palette', 'swatches, drawn', 'WCAG contrast per pair, mood, brand fit'],
    ['Typography', 'rendered sample (Thai + Latin)', 'licence, weights, Thai support, readability'],
    ['Layout / UI direction', 'wireframe, drawn', 'main pattern, pros / cons, accessibility'],
    ['Text option', 'shown in context', 'character count, tone, clash check'],
    ['Metric', 'big number + sparkline', 'trend, period, target, source'],
    ['Chart', 'rendered chart', 'what it shows, data source, period'],
    ['Price quote', 'price breakdown', 'total, included, excluded, term'],
    ['Line item', 'row', 'unit cost, quantity, total, source / assumed'],
    ['Financial instrument', 'name + mini chart', 'type, return, risk level, fees, liquidity — information only, not advice'],
    ['Record', 'row card', 'key fields, status, match status'],
    ['Source / document', 'publisher + date', 'credibility, recency, key quote'],
    ['Contract clause', 'clause excerpt', 'clause type, risk flag, deviation from standard'],
    ['Code / technical option', 'code snippet', 'language, dependencies, trade-offs'],
    ['Approach', 'icon + small diagram', 'pros, cons, effort, risk, time'],
    ['Idea', 'post-it', 'who suggested, votes, tags'],
    ['Task', 'task row', 'owner, due date, status, dependency'],
    ['Risk', 'severity badge', 'likelihood, impact, owner'],
    ['Goal', 'progress ring', 'target, current, owner'],
    ['Hypothesis', 'statement card', 'pass / fail rule, status'],
    ['Theme', 'theme card + quote count', 'sources backing it, example quote'],
    ['Question', 'question card', 'status, owner'],
    ['Message', 'sender + preview', 'sender, date, urgency, intent'],
    ['Requirement', 'field card', 'fields per item'],
    // Kind defaults the catalogue names in §2 but leaves out of §3 (routing test: the model had no type to pick)
    ['Agenda item', 'agenda row', 'time, owner, desired outcome'],
    ['Cause', 'cause card', 'evidence for, evidence against, likelihood'],
    ['Assumption', 'value + source chip', 'value, source or assumed, sensitivity'],
    ['Concept', 'concept card', 'plain definition, example, related ideas'],
    ['Claim', 'quote card', 'source, verdict'],
    ['Signal', 'dated change', 'date, what changed, source'],
    ['Scenario', '2×2 cell', 'driving forces, implications, early-warning sign'],
    ['Process step', 'step box', 'actor, hand-off, pain point'],
    ['Slide', 'slide thumbnail', 'the one message, visual'],
    ['Issue', 'severity badge', 'rule broken, severity, suggested fix'],
    ['Choice', 'choice card', 'our answer, why, what we stop doing'],
    ['Fact', 'fact card + source chip', 'source or assumed, date'],
    ['Decision', 'decision card', 'options, recommendation, who decides, by when']
  ];
  const IT_BY = Object.fromEntries(ITEM_TYPES.map(x => [x[0].toLowerCase(), x]));
  const itemOf = name => { const n = String(name || '').toLowerCase().split(/\s*\/\s*/)[0].trim(); return IT_BY[n] || ITEM_TYPES.find(x => n && x[0].toLowerCase().startsWith(n)) || null; };
  const NO_PHOTO = /^(person|group|colour palette|typography|layout|text option|metric|chart|line item|record|financial|contract|code|risk|goal|hypothesis|theme|question|task|idea|requirement|issue|choice|fact|agenda|cause|assumption|concept|claim|signal|scenario|process step|slide)/i;

  const DEPTHS = ['quick', 'standard', 'deep'];
  const RECUR = ['once', 'daily', 'weekly', 'monthly', 'quarterly', 'on trigger'];
  const SENS = ['normal', 'confidential', 'regulated'];

  const kindOf = w => w && w.kind && BY_ID[w.kind.id];

  // ---------- routing (catalogue §6), asked in the same call that sets the node up ----------
  function routingPrompt(k, opts){
    const forced = opts && opts.kind && BY_ID[opts.kind];
    const list = KINDS.map(x => `${x.id} | ${x.label} | engine "${x.engine}" | ${x.trigger}${x.item ? ` | items: ${x.item}` : ''}${x.fields.length ? ` | fields: ${x.fields.join('; ')}` : ''}${REPEATS.has(x.id) ? ' | usually repeats' : ''}`).join('\n');
    return `
KIND — what this node really does (CollabiQ Kinds catalogue). The OUTCOME (what will exist when the node is done), not the topic, picks the Kind:
knowledge / an answer → A Understand · one pick, a ranking or a judgement → B Choose · a new artefact → C Create · future work arranged → D Plan · something done in the world or with people → E Act.
${forced ? `The user chose Kind ${forced.id} "${forced.label}": use it, and "mode" MUST be "${forced.engine}".\n` : ''}Kinds (id | name | engine | typical words | default item type | fields every item states):
${list}
One short piece of text chosen among candidates (a subject line, a title, a name, a tagline) → Decide with Text option items; Write only when the text itself is the deliverable. Close pairs: "find a / one X for…" (one X still to be chosen) → Decide, "find / list X's" (several, to keep as a list) → Gather. Book / Buy ONLY when the pick is already made ("book the hotel we picked"); while it still has to be chosen, it is Decide, even if it will be booked later. One source → Summarize, many sources and patterns → Synthesize. Must end in one pick → Decide, a landscape view → Benchmark. Pick one → Decide, order many → Prioritize. Need a list → Gather, the same facts for each item → Benchmark. Checking against rules → Review, imagining what could go wrong → Assess risk. Open question on data → Analyze data, actuals vs a target → Evaluate results. A one-off total → Estimate, over time with drivers → Model / Forecast. Structured fields per item → Define, flowing text for a reader → Write. Many tasks over time → Plan, a time for people → Schedule. A new message → Send, an answer to one → Reply.
Big requests (expert coverage test: one shallow Kind was picked for big work):
- Plan ONLY when the outcome IS tasks arranged over time (who does what, by when). A review, an assessment, a budget, a policy, a pay review or a decision that will need a plan afterwards is that Kind, not Plan.
- Strategic choices only for where to play and how to win, argued in words. A choice that must be worked out in numbers (a valuation, an acquisition, capacity, pricing) → Decide, or Model / Forecast when the model is the deliverable.
- When the deliverable rests on analysis that has to come first (postmortems → their common themes; a memo that must first answer a technical question; a gap assessment before the remediation plan), pick the Kind of that FIRST piece of work.
- When the request lists the options to choose between (3 quotes, 5 bids, "these 3 directions"), pick Decide and return them as "given_options" — never search for others.
- When the request hands over a data table to work through (a salary file, a ticket, deal or event export, a sample of QA tickets to score on a rubric) and the first thing to produce is numbers or findings from it, pick Analyze data (or Evaluate results when it compares actuals with targets). Scoring a sample of records against a rubric to find patterns is Analyze data, not Review. The allocation, plan, coaching notes or decision built on those numbers comes after, as its own node. Two exceptions keep their own Kind: matching two lists against each other (leavers vs accounts, ledger vs return) is Reconcile; ranking given items on weighted criteria (a supplier scorecard, a backlog) is Prioritize.
"mode" MUST be the engine of the Kind you pick. If no Kind fits with confidence, pick K-00 (Custom, engine "find") — never refuse.
If "find": "items" are 3-6 questions to answer, each {"label": the question, "detail": one sentence, "kind": "fact" (answered from sources) or "yours" (only the user can answer), "dod": the number of the done-when item it serves, "dim"}.
For a Kind that lists fields, start from those as the "define" (or "gather") fields; change or add fields when the request's items need others (a content calendar: Date, Channel, Topic, Owner, Status) — up to 5 for "define", 4 for "gather".
ITEM TYPE: the kind of thing each item IS (not the Kind), one of: ${ITEM_TYPES.map(x => x[0]).join(', ')}. Start from the Kind's default item type and change it only when the items are clearly something else. A hotel, venue, restaurant or office to visit or book is a Place (Property is only real estate to rent or buy). With engine "find" the items are questions, but the item type is what the answers are ABOUT (a Theme, a Metric, a Cause, a Concept, a Source / document) — not Question. For Custom (K-00) the items are steps: Task when they are things to do (fix, set up, arrange), Approach when they are ways to think a question through. Mixed lists (e.g. build vs buy vs partner) → Approach.
MODIFIERS:
- "depth": quick | standard | deep. Most work is standard. Quick: a small task done on one screen (reply to one message, translate, reformat, prepare one meeting). Deep: ONLY when a wrong result is costly AND it needs many sources (a market entry, a multi-year forecast, build vs buy). A launch plan, a ranking or a risk list is standard.
- "recurrence": once | daily | weekly | monthly | quarterly | on trigger — when the request says it repeats ("every Friday", "each month"), OR the Kind "usually repeats" and the request names a period ("last month's statement" → monthly, "this week's update" → weekly). A one-off ("compare these two lists") stays once.
- "people": none | waiting (needs replies from others).
- "external": "" or what would leave CollabiQ (send, post, book, pay, update another system).
- "connector": "" or the system it needs (email, calendar, CRM, drive, accounting, BI). A question about the organisation's OWN numbers needs the system they live in, even when the request doesn't name it: money (burn rate, runway, cash, invoices) → accounting; product or sales metrics (sign-ups, churn, conversion, revenue by channel) → BI.
- "sensitivity": normal | confidential | regulated. Regulated ONLY when the result could be taken as legal, medical, tax or investment advice, or it handles personal data about people (a contract's clauses, a privacy or data law such as PDPA or GDPR, which fund or ETF to buy, health). Everyday business numbers (budgets, forecasts, burn rate, bank reconciliations) are normal, or confidential when internal.
- "collaboration": solo | shared.
Add to the JSON: "kind": {"id": "K-..", "confidence": "high" | "close" | "low", "alt": the id of the close second Kind or ""}, "given_options": [the option names the request itself lists, or []], "item_type": "...", "modifiers": {"depth": "standard", "recurrence": "once", "people": "none", "external": "", "connector": "", "sensitivity": "normal", "collaboration": "solo"}.
`;
  }

  // Replaces the page's older "Decide what kind of Research node this is" list, which offered only 4 engines and its
  // own rules for choosing one (routing test: it competed with the Kind and pulled requests towards "design").
  function engineBlock(){
    return `ENGINES — the Kind you picked sets "mode". This only says what each engine's data holds; do not choose the engine on its own. If the engine feels wrong for the request, pick a better-fitting Kind instead.
- "decide": options to choose among, judged on criteria.
- "find": questions answered from sources (or by the user).
- "gather": items collected from public pages, each checked against rules.
- "define": a list of items the user agrees on, each stating the same fields.
- "design": rules or a spec for 2 or more named parts, built from how well-known others do each part.`;
  }

  // Pick the Kind and its engine from the AI's answer. The engine must match the data that came back.
  function apply(w, res, o){
    const planned = o && o.planned, forced = o && o.forced && BY_ID[o.forced];
    const rk = res && res.kind && typeof res.kind === 'object' ? res.kind : { id: res && res.kind };
    let kind = forced || BY_ID[String(rk.id || '').trim()] || null;
    const conf = forced ? (o && o.plannedKind ? 'planned' : 'chosen') : ['high', 'close', 'low'].includes(rk.confidence) ? rk.confidence : 'high';
    if(!forced && conf === 'low' && !planned) kind = BY_ID['K-00'];
    // The engine follows the shape of the data that came back (w.mode, set by the caller); a Kind on another engine
    // falls back to that engine's default Kind. A Kind the user chose wins when its data came back.
    const has = m => m === 'find' || m === 'decide' || !!(res && res[m]);
    let mode = w.mode;
    if(forced && has(forced.engine)) mode = forced.engine;
    if(!kind || kind.engine !== mode) kind = BY_ID[DEFAULT_FOR[mode]] || BY_ID['K-B1'];
    const alt = !forced && BY_ID[rk.alt] && rk.alt !== kind.id ? rk.alt : '';
    w.kind = { id: kind.id, conf, alt };
    const it = itemOf(res && res.item_type) || itemOf(kind.item);
    w.itemType = it ? it[0] : '';
    const m = (res && res.modifiers) || {}, d = kind.mods, pick = (v, list, def) => list.includes(v) ? v : def;
    w.mods = {
      // the Kind's own depth (Reply is quick, Model / Forecast is deep) stands unless the model says otherwise than "standard"
      depth: m.depth && m.depth !== 'standard' && DEPTHS.includes(m.depth) ? m.depth : d.depth || 'standard',
      recurrence: pick(m.recurrence, RECUR, d.recurrence || 'once'),
      people: m.people === 'waiting' || d.people === 'waiting' ? 'waiting' : 'none',
      external: String(m.external || '').trim() || d.external || '', // a Kind that acts outside always keeps its gate
      connector: String(m.connector || '').trim() || d.connector || '',
      sensitivity: [pick(m.sensitivity, SENS, 'normal'), d.sensitivity || 'normal'].sort((a, b) => SENS.indexOf(b) - SENS.indexOf(a))[0], // never below the Kind's own level
      collaboration: m.collaboration === 'shared' ? 'shared' : 'solo'
    };
    // A schedule Planning set on the node wins over the routing guess (round 81)
    if(o && RECUR.includes(o.recurrence) && o.recurrence !== 'once'){ w.mods.recurrence = o.recurrence; w.mods.until = o.until || ''; }
    if(kind.id === 'K-00') log({ t: 'custom', node: typeof EX !== 'undefined' ? EX.cur : '', title: o && o.title, at: Date.now() });
    w.givenOptions = (Array.isArray(res && res.given_options) ? res.given_options : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 15);
    return mode;
  }
  // After the engine is set up: what the Kind changes inside it.
  function afterStart(w){
    const kind = kindOf(w); if(!kind || !w.mods) return;
    if(w.mode === 'decide'){
      if(w.mods.depth === 'quick' && !w.book) w.light = true; // a quick choice: pick straight from the options
      if(kind.mods.pickMany && (!w.pick || w.pick.max <= 1)) w.pick = { min: 3, max: Math.max(5, Math.ceil((w.optCount || 8) / 2)), fromDod: false };
      if(kind.id === 'K-E12') { w.book = true; w.light = false; }
      // The user already listed the options (3 quotes, 5 bids): they come in kept, and none are searched for.
      if((w.givenOptions || []).length >= 2 && !w.options.some(x => x.fromInput)){
        w.options = w.givenOptions.map(label => ({ id: rsId('o'), label, detail: '', why: 'Listed in “your request”', web: null, facets: [], kept: true, fromInput: true }));
        w.optCount = w.options.length;
      }
    }
  }
  // The request may need more fields than the Kind's defaults (a content calendar needs five).
  const maxFields = (w, def) => kindOf(w) ? (def >= 3 ? 5 : 4) : def;

  // ---------- what the AI is told on every call for this node ----------
  function ctx(w){
    const kind = kindOf(w); if(!kind) return '';
    const it = itemOf(w.itemType), m = w.mods || {};
    const mods = [];
    if(m.depth === 'quick') mods.push('Depth quick: keep it short — few items, no extra sources.');
    if(m.depth === 'deep') mods.push('Depth deep: cover every step, use more sources, flag anything uncertain.');
    if(m.recurrence && m.recurrence !== 'once') mods.push(`Recurring (${m.recurrence}): the result is one dated run; say what changed since the last run.`);
    if(m.people === 'waiting') mods.push('Waits on other people: list whose reply is needed; it never blocks the rest of the work.');
    if(m.external) mods.push(`Acts outside CollabiQ (${m.external}): draft it ready to go, but never send, post, book, pay or update anything — a person approves first.`);
    if(m.connector) mods.push(`Needs a ${m.connector} connector, which this prototype does not have: produce the result as a draft or instructions and say which connector would let it act.`);
    if(m.sensitivity === 'regulated') mods.push('Regulated (legal, medical, financial or personal data): give information with sources and an "expert review" flag — never personal advice; use the minimum personal data.');
    if(m.sensitivity === 'confidential') mods.push('Confidential: work-relevant facts only; no personal details beyond what the work needs.');
    if(m.collaboration === 'shared') mods.push('Shared: several people vote and comment on the items.');
    const steps = exRsSteps(w).map(s => s.label).join(' → ');
    // Round 83: a list split into parts (30 / 60 / 90 days) and a list that must end with one item (one subject line)
    const dd = w.mode === 'define' && w.def;
    if(dd && (dd.sections || []).length) mods.push(`Sections: the list is split into ${dd.sections.map((x, i) => `${i + 1}. "${x.label}"`).join(', ')}. Every item you add sets "section" (its number), and every section gets items of its own.`);
    if(dd && dd.max === 1) mods.push(`One only: the node ends with exactly ONE ${dd.noun}. Offer alternatives to choose from, but keep (or recommend) only one.`);
    return `
KIND this node runs as: ${kind.label} (${kind.id}, ${FAMILIES[kind.fam]}). The catalogue's steps: ${kind.steps}. On this node they are: ${steps}. ${kind.guide}${kind.fields.length ? ` Fields for each item: ${kind.fields.join('; ')}.` : ''} Result: ${kind.result}.${it ? `
ITEM TYPE: ${it[0]} — shown as ${it[1]}; key facts for each item: ${it[2]}. Default criteria come from these facts.` : ''}
Every fact on an item carries its source, or is marked "assumed" or "your input". Never make up a photo of a real place, a logo of a real company, or a face of a real person.${mods.length ? `
MODIFIERS: ${mods.join(' ')}` : ''}`;
  }

  // ---------- header: "Running as <Kind> · Change" ----------
  function modsText(w){
    const m = w && w.mods; if(!m) return '';
    const out = m.depth === 'standard' ? [] : [rsCap(m.depth)]; // nothing to say for a standard, one-off node
    if(m.recurrence !== 'once') out.push(`Recurring · ${m.recurrence}${m.until ? ` until ${m.until}` : ''}`);
    if(m.people === 'waiting') out.push('Waits on others');
    if(m.external) out.push(`Approval before it acts (${m.external})`);
    if(m.connector) out.push(`Draft only — needs ${m.connector}`);
    if(m.sensitivity !== 'normal') out.push(rsCap(m.sensitivity));
    if(m.collaboration === 'shared') out.push('Shared');
    return out.join(' · ');
  }
  function label(w){ const kind = kindOf(w); return kind ? kind.label : ''; }
  function headHtml(k, ro){
    const w = exRsW(k), kind = kindOf(w); if(!kind) return '';
    const alt = w.kind.alt && BY_ID[w.kind.alt];
    const can = !ro && !w.busy && !exState(k).done;
    return `<span class="xk-run">Running as <b>${E(kind.label)}</b>${w.itemType ? ` · ${E(w.itemType)}` : ''}${can ? ` · <button type="button" class="xo-link rs-kind-switch" data-xk-act="change" title="${E(alt ? `Close call with ${alt.label}` : 'Choose another Kind — starts this node over')}">Change</button>` : ''}</span>`;
  }
  function modsHtml(k){ const t = modsText(exRsW(k)); return t ? `<p class="xo-sub xk-mods">${E(t)}</p>` : ''; }

  // ---------- the gate before Complete (catalogue §1, §4) ----------
  function gateReasons(k){
    const w = exRsW(k), m = w && w.mods; if(!m || !kindOf(w)) return [];
    const out = [];
    if(m.external) out.push(`It acts outside CollabiQ: ${m.external}. Nothing is sent, posted, booked or paid from this prototype — approving clears the hand-off to act.`);
    if(m.sensitivity === 'regulated') out.push('Regulated topic: this is information with sources, not advice. An expert should review it before anyone acts on it.');
    // Depth alone never gates (routing test: "deep" on a launch plan or a ranking made the gate fire on half the nodes);
    // a review before Complete for big work is the Node complexity v2 gate's job.
    return out;
  }
  function gateHtml(k){
    const why = gateReasons(k); if(!why.length) return '';
    const w = exRsW(k), g = w.xkGate || {}, ro = !!exState(k).done;
    return `<section class="cx-gate" aria-label="Approval gate"><p class="cx-h cx-h--top">Approval gate</p><ul class="cx-list">${why.map(x => `<li>${E(x)}</li>`).join('')}</ul>
      ${g.ok ? `<p class="cx-gate-ok" role="status">✓ Approved · ${E(new Date(g.at).toLocaleString())}${ro ? '' : ' <button type="button" class="ip-mini" data-xk-act="gate-undo">Change</button>'}</p>`
        : `<div class="ip-row-actions"><button type="button" class="btn ip-btn-sm" data-xk-act="gate-ok"${ro ? ' disabled' : ''}>Approve</button></div>`}</section>`;
  }
  function missing(k){ const w = exRsW(k); return gateReasons(k).length && !(w.xkGate && w.xkGate.ok) ? ['the approval gate'] : []; }
  // Photos only where the item type is a real, visible thing (never of people; drawn types draw their own visual).
  function noPhotos(){ const k = typeof EX !== 'undefined' && EX.cur, w = k && exState(k) && exState(k).w; return !!(w && w.itemType && NO_PHOTO.test(w.itemType)); }

  // ---------- Change: pick another Kind (restarts the node) ----------
  function openPicker(k){
    const w = exRsW(k), cur = kindOf(w); let dlg = document.getElementById('xk-dlg');
    if(!dlg){ dlg = document.createElement('dialog'); dlg.id = 'xk-dlg'; dlg.className = 'modal xk-dlg'; dlg.setAttribute('aria-labelledby', 'xk-dlg-h'); document.body.appendChild(dlg); }
    const alt = w.kind.alt && BY_ID[w.kind.alt];
    dlg.innerHTML = `<div class="modal-head"><h2 id="xk-dlg-h" class="xk-dlg-h">What this node does</h2><button type="button" class="modal-close-btn" data-xk-act="close" aria-label="Close">✕</button></div>
      <div class="xk-dlg-body">
        <p class="ip-hint">Running as <b>${E(cur.label)}</b>${alt ? ` — a close call with <b>${E(alt.label)}</b>` : ''}. Choosing another Kind starts this node over.</p>
        ${Object.keys(FAMILIES).map(f => `<section class="xk-fam"><p class="cx-h">${E(f === 'F' ? FAMILIES[f] : `${f} · ${FAMILIES[f]}`)}</p><div class="xk-grid">
          ${KINDS.filter(x => x.fam === f).map(x => `<button type="button" class="xk-opt${x.id === cur.id ? ' is-cur' : ''}${alt && x.id === alt.id ? ' is-alt' : ''}" data-xk-act="pick" data-id="${x.id}" aria-pressed="${x.id === cur.id}"><b>${E(x.label)}</b><span>${E(x.steps)}</span></button>`).join('')}
        </div></section>`).join('')}
        <section class="xk-fam"><label class="cx-h" for="xk-it">Show items as</label>
          <div class="xk-row"><select id="xk-it" class="ip-field">${['<option value="">Detected from the items</option>'].concat(ITEM_TYPES.map(x => `<option${x[0] === w.itemType ? ' selected' : ''}>${E(x[0])}</option>`)).join('')}</select>
          <button type="button" class="btn ip-btn-sm" data-xk-act="item">Apply</button></div>
          <p class="ip-hint">Changes how items are described from now on. It doesn't start the node over.</p></section>
      </div>`;
    dlg.dataset.k = k;
    if(!dlg.open) dlg.showModal();
    const c = dlg.querySelector('.xk-opt.is-cur'); if(c) c.focus();
  }
  function restart(k, id){
    const st = exState(k), from = st.w && st.w.kind && st.w.kind.id;
    log({ t: 'change', node: k, from, to: id, at: Date.now() }); // how often users switch = router error rate per Kind pair
    st.w = exRsInit(k); st.output = ''; st.dod.forEach(d => { d.ok = false; d.note = ''; });
    return exRsStart(k, { kind: id });
  }
  function log(x){ try { const a = JSON.parse(localStorage.getItem('ciq.execKinds.log') || '[]'); a.push(x); localStorage.setItem('ciq.execKinds.log', JSON.stringify(a.slice(-200))); } catch(e){} }

  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-xk-act]'); if(!b) return;
    const act = b.dataset.xkAct, dlg = document.getElementById('xk-dlg'), k = act === 'pick' || act === 'item' ? dlg && dlg.dataset.k : EX.cur;
    if(act === 'close'){ dlg.close(); return; }
    if(!k) return;
    const w = exRsW(k);
    if(act === 'change') return openPicker(k);
    if(act === 'pick'){ const id = b.dataset.id; dlg.close(); if(w.kind && id === w.kind.id) return; return restart(k, id); }
    if(act === 'item'){ const v = dlg.querySelector('#xk-it').value; w.itemType = v; dlg.close(); return exRsRefresh(k, true); }
    if(act === 'gate-ok'){ w.xkGate = { ok: true, at: Date.now() }; return exRsRefresh(k, false); }
    if(act === 'gate-undo'){ w.xkGate = null; return exRsRefresh(k, false); }
  });
  document.addEventListener('click', ev => { const d = ev.target; if(d && d.id === 'xk-dlg' && d.open) d.close(); }); // click on the backdrop

  // ---------- wrap the shared functions ----------
  const W = (name, fn) => { const orig = window[name]; if(typeof orig !== 'function') return; window[name] = function(){ return fn.call(this, orig, arguments); }; };
  W('exRsSteps', (o, a) => {
    const w = a[0], base = o.apply(null, a), kind = kindOf(w); if(!kind || w.mode !== kind.engine) return base;
    const quick = typeof rsQuick === 'function' && rsQuick(w); // a quick choice keeps its own "Pick" step
    return base.map(s => kind.labels[s.key] && !(quick && s.key === 'options') ? Object.assign({}, s, { label: kind.labels[s.key] }) : s);
  });
  // The page calls every node "type Research", which pulled routing towards finding things out (routing test);
  // the Kind says what the node does, so the type label is left out.
  W('exCtx', (o, a) => { const k = a[0], w = exState(k) && exState(k).w; return o.apply(null, a).replace(/ — type Research, lane /, ' — lane ') + (w ? ctx(w) : ''); });
  W('exMissing', (o, a) => o.apply(null, a).concat(exStep(a[0]).nodeType === 'research' ? missing(a[0]) : []));

  // ---------- Planning (round 77): every node gets a Kind; big work is a chain of Kinds that ends in one assembly node ----------
  const ENGINE_APPROACH = { decide: 'decide', gather: 'gather', define: 'define', design: 'design' };
  // What the target product's nodes can do (inbox, approvers, scheduling, connectors, knowledge base), so Planning
  // plans the nodes that use them. The prototype's nodes still only draft; set false to plan for the prototype as it is.
  const PLAN_WITH_PLATFORM = true;
  const PLATFORM_BLOCK = `WHAT NODES CAN DO — plan with it:
- INBOX: Survey (K-D7), Send (K-E3), Follow up (K-E5) and Request / Approve (K-E10) really email named people inside or outside the company, and their replies and attachments come back into that node as inputs. When the work needs other people's input, evidence, bids, answers or a decision (country leads, function heads, bidders, the vendor, an adviser, department owners), plan a node that sends the request and collects the replies BEFORE the nodes that use them. Never plan to work from inputs nobody was asked for.
  REQUIRED: whenever a deliverable depends on input, evidence, data, answers, bids or a confirmation from anyone other than the user (a vendor, bidders, reps, control or department owners, an implementation team, function heads), add a Survey, Send or Request / Approve node that collects it, and make every node that uses it depend on that node.
- APPROVERS: every node is approved by the person who created the workstream unless another approver is set ("approver": "" means the creator). Set a different approver ONLY when the result needs a qualified or accountable person other than the creator: a legal, tax, accounting or regulatory conclusion (counsel, tax adviser, auditor, DPO), or a money commitment or decision that belongs to someone else (a finance approver, the MD). Then set that node's "approver" — the role when no person is named (e.g. "External counsel", "DPO", "Finance approver") — instead of adding a node just to approve. Leave routine work to the creator, and never ask the user who approves it. Use an "approve" node only for a review pack someone signs at the end.
- SCHEDULING AND REPEATS: Schedule (K-D8) books real meetings against calendars. Every step has "recurrence" ("once" | "weekly" | "monthly" | "quarterly") and "until" ("YYYY-MM-DD" or ""), and the node reruns by itself on that schedule — so work that repeats is ONE node, never a node per run.
  REQUIRED: follow "Repeats" in the confirmed intent. When the whole workstream repeats, give that recurrence to every node that must run each period. When only a part repeats, give it only to the node that does that part (for tracking: Status update (K-E7) to report, or Follow up (K-E5) to chase), with "until" when the intent has an end date. Every other node is "once". A booked meeting or a report template is not tracking.
- NUMBERS NEED A SOURCE. REQUIRED: every number the result relies on (an amount owed, a claim or counterclaim, a win rate, a price, a cost, a recovery estimate, an allocation) is produced by a node before the node that uses it: pull the data from a connector, the knowledge base or a collect node, and compute it in Calculate (K-C7), Analyze data (K-A6), Reconcile (K-E11) or Estimate (K-C6). Never let a decision or memo node invent its own figures.
- CONNECTORS AND KNOWLEDGE BASE: nodes read company systems (CRM, ERP / ledger, HRIS, LMS, claims, code repository, calendars) and search the company knowledge base (policies, standards, contracts, past reports, rate sheets). Plan to pull from them; ask the user only when it is unclear which system or document holds the data.
`;
  function planningBlock(){
    const list = KINDS.filter(x => x.id !== 'K-00').map(x => `${x.id} | ${x.label} | ${x.trigger}`).join('\n');
    return `KINDS — every step also gets a "kind": the id of the ONE kind of work that node does (list below). Its "approach" is that Kind's engine when the engine is decide, gather, define or design; otherwise "approach" is "".
${list}
PICK THE KIND BY WHAT THE NODE PRODUCES — these get confused:
- Schedule (K-D8) only finds a time for a meeting or books calendar slots. A timeline, roll-out or training schedule, close calendar, dated task list or recurring cadence is Plan (K-D1); chasing people for their inputs is Follow up (K-E5).
- Scenarios (K-D3) frames uncertainty as a few named futures (e.g. a 2×2). Base / upside / downside cases, a sensitivity, a reallocation or a quantified impact (e.g. of an 8-week stoppage) is Model / Forecast (K-C5); a cost or effort range is Estimate (K-C6).
- Benchmark (K-B3) and Gather (K-B2) search the web. When the user supplies the options (bids, quotes, proposals, CVs, the agency's directions), compare them in Decide (K-B1), which takes the listed options as given, or check them against rules in Review (K-B5) — never search for them.
- Reconcile (K-E11) matches records across two or more sources on a key (IDs, ledgers, lists) and reports matched / differ / missing. Transform (K-C11) only reshapes or cleans data without matching sources. Reading documents (bids, contracts, proposals) to pull their items, exclusions and prices onto one common scope is Extract (K-A5), not Reconcile.
- Decide (K-B1) picks one option. Splitting a budget or capacity across several things is Estimate (K-C6) or Model / Forecast (K-C5); a ranked set is Prioritize (K-B4).
- Design (K-C4) designs a system, flow or brand from how others do it. Prices, fees and terms are Estimate (K-C6) or Calculate (K-C7); an agenda and pre-reads are Meeting prep (K-D10); a tracker's fields are Define (K-C3).
- Test a hypothesis (K-B7) tests a claim with users or data; an adjustment to a number (a synergy haircut) is Estimate (K-C6).
- ONE piece of writing is ONE node (Write, K-C2): an email's subject line, greeting, body and sign-off, or a post's headline and text, are parts inside it — never nodes of their own. Choosing one short text among candidates (a subject line, a name, a tagline) on its own is Decide (K-B1).
- Goals split by period (a 30-60-90 day plan, quarterly OKRs) are ONE Set goals (K-D2) node whose list has one part per period — not a node per period.
- A list of dependencies between work items (each item, what it depends on, why) is Define (K-C3); putting the work in dated order with owners is Plan (K-D1). Neither is Organize (K-C12), which only groups or tags.
- Strategic choices (K-D4) sets where to compete over years; one choice between named courses of action (negotiate or go to adjudication) is Decide (K-B1).
- Budget vs actual and results vs a target are Evaluate results (K-A12), which holds Target / Actual / Variance & reason. Redlines and fallback positions against a playbook are Review (K-B5); Negotiation prep (K-D9) is only for preparing a negotiation conversation.
${PLAN_WITH_PLATFORM ? PLATFORM_BLOCK : ''}DEADLINES FIRST. When one deliverable is due much sooner than the rest (within hours, or before the next working day: "in 1 hour", "tomorrow", "before Monday's call"), plan it in its own lane with no "dependsOn", built from what is known now, and let the slower work follow. Nothing the urgent node needs may wait for later analysis or a later approval. Analysis on a clock (a legal notification deadline, a briefing in hours) also starts from what is known now — the facts in hand, the knowledge base, connectors — and never waits for a reply from someone outside; when that reply arrives, a later node updates the analysis.
ORDER AROUND REPLIES. Whatever people need before they can reply (questions answered, clarifications, a Q&A round) is handled in or before the node that collects their replies, never after it. A node that signs something off comes after everything it signs.
SIZE THE WORK FIRST. Work one person finishes in one sitting (a daily or routine task: a reply, a calculation, a report or commentary from a file, a review against rules, a reconciliation, an onboarding plan) is ONE node, or TWO only when the second part needs a different Kind's steps or a different person or sign-off (e.g. reconcile, then write the filing summary; research the company, then prepare the call). Several parts of one-sitting work are steps or fields inside that node, not separate nodes — one node's Calculation step runs several calculations in order. One-sitting work never gets an assembly node.
BIG WORK IS A CHAIN OF KINDS. Multi-day or senior work — several deliverables that need different people or sign-offs, a decision or strategy that rests on analysis, or input to collect from others — is planned as a chain: the analysis first (e.g. Find out, Analyze data, Synthesize, Situation analysis, Assess risk, Model / Forecast, Estimate), then the choices built on it (Decide, Prioritize, Strategic choices), then the plan and the actions (Plan, Write, Present, Send). One Kind per node, in the order the work needs (the order inside a lane, or "dependsOn" between lanes). An analysis and the decision that rests on it are separate nodes when each is something someone signs or relies on (e.g. the valuation the board relies on, then the recommendation) — as the node rules above allow; otherwise the analysis is a step inside the decision node.
ASSEMBLE AT THE END. Only for that multi-day or senior work, add ONE last lane titled "Assemble the deliverable" with ONE step: kind "K-G1", approach "define", and "dependsOn" listing every other lane's title. It turns all the nodes' results into the decisions the reader must settle (options, recommendation and why, who decides by when, which node it rests on) and hands the Workstream result one coherent deliverable. Small work with one deliverable needs no assembly step.
`;
  }
  const planKind = v => { const id = String(v == null ? '' : v).trim().toUpperCase(); return BY_ID[id] && id !== 'K-00' ? id : ''; };
  const approachOf = id => (BY_ID[id] && ENGINE_APPROACH[BY_ID[id].engine]) || '';
  const labelOf = id => (BY_ID[id] ? BY_ID[id].label : '');
  // the Workstream result: an assembly node's decisions are final content, not open items
  function assemblyNote(){
    const has = typeof IP !== 'undefined' && (IP.lanes || []).some(l => l.steps.some(s => s.nodeInfo && s.nodeInfo.kind === 'K-G1'));
    return has ? '\n- DECISIONS ARE FINAL CONTENT: the "Assemble & decide" node lists the decisions the reader must settle. Open the main deliverable with a short answer, then a "Decisions" section — for each: the decision, the options, the recommendation and why, who decides and by when, and which node’s result it rests on. That section is not an open item, a to-do or a placeholder; everything else stays final content.' : '';
  }
  // Planning's prompt: the Kinds and the chain + assembly rules, and "kind" in each step's JSON
  W('ipPlanningPrompt', (o, a) => {
    let p = o.apply(null, a);
    const at = p.indexOf('Respond ONLY with a raw JSON object');
    if(at > 0) p = p.slice(0, at) + planningBlock() + '\n' + p.slice(at);
    // With approvers per node, an approver is set by role even when no person is named (round 80: the old wording won)
    if(PLAN_WITH_PLATFORM) p = p.replace('("owner", "approver": a person or role ONLY if the known facts name them, else "" — when someone must approve and the facts don\'t say who, add an "ask_user" question)', '("owner": a person or role only if the known facts name them, else ""; "approver": see APPROVERS below — "" means the workstream creator approves)');
    p = p.replace('"steps": [{"nodeType", "approach", "title"', '"steps": [{"nodeType", "approach", "kind", "title"');
    return PLAN_WITH_PLATFORM ? p.replace('"approver": "",', '"approver": "", "recurrence": "once", "until": "",') : p;
  });
  window.ExKinds = { KINDS, ITEM_TYPES, FAMILIES, planningBlock, planKind, approachOf, labelOf, assemblyNote, routingPrompt, engineBlock, apply, afterStart, maxFields, ctx, label, headHtml, modsHtml, gateHtml, missing, noPhotos, openPicker };
})();
