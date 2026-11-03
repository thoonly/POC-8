# Workstream POC — features by node

Source: README round notes (up to Round 65) and the prototype code (entry-v4.html, components/). Most AI features were tested with simulated AI replies, not a real model.

---

## 1. Entry node

**Overall**
- Typing a request on the start page builds the Entry graph (gap questions first in Chat, when the request misses something).
- Template picks wait as "Adding". **Update scope** commits them: Chat posts "Add these to scope" and the Output lists them under "Added to scope".
- **Create workstream** hands the request, purpose and in-scope picks to Intent clarification (shown in its Inputs and "From Entry node").

**Chat**
- Ask questions, give commands, add context ("+ Add context"); changes land in the graph, Answer or Actions.
- Gap questions ("What context is missing from this prompt?").
- Research with web search; the pages used go to Sources.
- Photo answers: "What is X?" / "What does X look like?" adds a credited photo.
- Highlight text in a message → **✦ Ask AI** (puts the words in the chat box as a reference tag `@[“…”]`; you write the question) / **＋ Make a post-it**.

**Cognitive Field**
- **Canvas only** — no mode icons and no Refresh (it updates by itself); in 2-panel layout only Canvas | Chat.
- **About this node:** your request; Right now (pick ideas → Update scope).
- **Template:** one table per idea category.
  - Table: ★ In scope and "Adding" items.
  - Ideas below each table: drag on, double-click or Enter to use; Delete leaves it out (Not interested).
  - "+ Add to …" for your own idea (Enter adds it).
- **Inputs:** your request, line by line; each line drags onto a table.
- **Graph component:** Graph (categories, topics, Explore ideas, semantic zoom, node cards) · Text · Sources.
- **Canvas:** post-its (Enter finishes one), cards, Explore more, dot voting, multi-select, Compare, Ctrl/⌘+Z undo and Ctrl/⌘+Shift+Z redo, scroll pans and pinch / Ctrl+scroll zooms.

**Output**
- Answer and Actions (proposed workstreams).
- Scope picks ("Added to scope").
- Create workstream (the handoff).

---

## 2. Intent clarification

**Overall**
- The canvas template and the intent document are one: a change in either shows in the other.
- Changing purpose, who it's for, scope or deliverables makes Planning rebuild its draft plan to match the next time it opens.
- Locked once Planning is confirmed; after that, changes go through Chat with an impact check on the plan.
- What the request plainly names is added to scope automatically, without asking.
- **Continue to planning** opens Planning (it starts in Chat); "Update plan →" when the intent changed after a plan was built.

**Chat**
- Change the intent ("set Who is this outcome for?", scope, deliverables), with conflict checks.
- Help me decide; research with sources.
- Photo answers, Ask AI reference tags and highlighted text, as in Entry.

**Cognitive Field**
- **About this node:** name and purpose; Right now (say who it's for, add a deliverable, continue to planning).
- **Template:**
  - **Purpose:** one post-it per point, reworded in place, in sync with the Output.
  - **Who is this outcome for?**, **In scope** (AI insights as ideas), **Out of scope**, **Deliverables** (with done-when).
- **Inputs:** what Entry handed over (request, purpose, in-scope picks).
- **Graph component:** the intent's themes graph (rebuilt automatically when the intent changes), Text, Sources.
- **Canvas:** post-its, cards, Explore more, voting, undo / redo.

**Output — the intent document**
- **Step 1 · Purpose & who it's for:** Purpose check before you can go on, Refine purpose (scope questions), Who is this outcome for?
- **Step 2 · Scope & deliverables:**
  - Generate scope & deliverables (every check finishes before the draft shows).
  - In / out of scope, deliverables with done-when, conflict flags.
- **Continue to planning →** / **Update plan →**.

---

## 3. Planning

**Overall**
- Choosing a way of working in Chat builds the plan into the Output.
- **The plan follows the intent:** whenever Planning opens and the intent changed, the draft plan is rebuilt the same way, and Chat names what changed.
- Adding or removing a node (canvas, node menu or Chat) goes through Planning Chat or its confirmation.
- **Removing a node or a group always asks first** (Draft or confirmed): what would go and what it affects → **Yes, remove it / Keep it**.
- A confirmed plan gets an impact check on every change: **Make the change / Keep the plan as it is**.
- **Confirm planning** unlocks the execution nodes; the plan drops its draft look.
- Every done-when point of every deliverable is matched to a node automatically; gaps are filled before the plan first shows.

**Chat**
- How to plan it: the ways card (A / B / C, Recommended, "My own way"); each way's flow as **numbered steps** → Build / Show / Update the plan.
- **My own way:** your steps are kept in your order and words; the AI adds a step only where the intent needs one (marked "Added", with why) and offers **Remove <added steps>** to rebuild from your steps only.
- **Reads what you mean:** "this sounds redundant", "we don't need that", "remove <node name>":
  - a whole node or group → asked first, with its impact;
  - part of a node → just that part is cut: "The redundant part — … — has been cut from <node>. <What stays> is still there because …".
- Edit the plan by reference (`@[Node 1.2 · …]` from a node's Ask AI menu).
- The planner's questions open Chat and focus the first answer.

**Cognitive Field**
- **About this node:** the plan's objective; Right now (choose a way → review → confirm).
- **Template:** one table per group with its nodes; "+ Add" and removals go to Planning Chat.
- **Inputs:** the confirmed intent (purpose, who for, scope, deliverables with done-when).
- **Graph component:** groups and nodes as a graph, Text, Sources.
- **Canvas:** post-its, cards, Explore more, voting, undo / redo (canvas items; plan changes are made by Chat).

**Output**
- Before a plan: "Choose how to plan it in Chat".
- **Planning mode:** Node complexity (default), Standard, Node complexity v2 — each keeps its own draft.
- **Plan canvas:**
  - Lanes and nodes, prerequisites ("🔒 After 1 + 2", "Free to start", "Unlocked"), hover highlights a lane's lines.
  - Yellow "Draft — not final yet" look.
  - Click a node → **✦ Ask AI · Node information · Remove node… · Remove group…**; double-click to open it.
- **Node information:** purpose, done-when, type; Node complexity adds sign-off, owner, approver, checkpoint; v2 adds level, substeps, needed context. Read-only after confirming.
- **Confirm planning** → **Continue: <next node> →**.

---

## 4. Execution node

**Overall**
- Canvas and Output are one state: a choice in either shows in both.
- Output opens by itself at the Result step.
- **Complete node** sends the hand-off to the next nodes' Inputs and opens the next node.
- **Reopen to edit:** completing it again with a change updates every later node ("Input changed").
- Node set-up overlay ("Setting up · <node>") while the AI picks the framework and steps.
- With Node complexity v2: default panels per level, a node brief, and a gate before Complete.

**Chat**
- "add post-its: A; B [to Options]".
- Asking about a named hotel or venue looks it up and offers to add it.
- "Which criteria matter most?", "Compare the options in a table", "What if cost mattered more?".
- Photo answers, Ask AI reference tags and highlighted text, as above.

**Cognitive Field**
- **About this node:** Right now (action, how, why, then); what each template is for.
- **Templates:**
  - One per step, with AI flow arrows that carry items forward, and locked previews of later steps.
  - Default width fits the view at 100%; drag the edge to make it narrower.
  - Kept items as post-its; AI ideas below each table; Suggest more; drafts (Keep these ideas / Undo).
  - **Let me help (AI cursor):** works on the step you're on, explains each pick, and **every run ends with Keep / Undo**.
  - Photo carousel on options and collected places ("No photo found" + why); logos on products.
- **Steps by kind:**

| Kind | Steps |
|---|---|
| Decide | What matters (a template step) → Options → Compare: **1 Check the data** (edit values, add / take out criteria) → **2 Scores** in words (Low / Medium / High cost, a time in min / h, Yes / No, Poor … Excellent) → Decide |
| Gather | Kinds → Collect → Pick (each item checked against your rules) |
| Define | Draft (fields per item) |
| Find out | Questions → Findings |
| Design | Research documents → Decide what must be settled → Borrow ideas → Your logic → logic document → carry into next part |

- **Design mode extras:**
  - Research documents: Document / Key ideas, Explore more, select-text menu, Export PDF, ⤢ full screen inside the Cognitive Field.
  - Logic document: inline edit, Ask for a change, Check for gaps, answer open questions; later parts update in turn.
- **Template choices** (Decide choices, settle options, ideas to borrow, picked ideas) drag onto the canvas as cards (Show on template, Add to template, Make post-it, Explore more).
- **Inputs:** earlier nodes' outputs, one short document per node; every line drags onto a template.
- **Graph component:** Graph (Now / Why we're here / step by step), Text, Sources, full screen; Explore more opens extra graphs; nodes drag out as cards.
- **Canvas:** post-its (Enter finishes one), cards, voting, multi-select, Compare tables, Ctrl/⌘+Z undo wherever the focus is, scroll pans and pinch / Ctrl+scroll zooms.

**Output**
- **Header:** node, lane, status, title, type; Node details, Node information, Export this node, Start this node over.
- **One step at a time**, following the current step, with a stepper to look back.
- **Compare step:** Check the data → Looks right — calculate the scores → scores in words; Check the data again.
- **Result step:**
  - Summary box, "Handed to the next node", "Definition of done".
  - Result document (decision, scores in words, comparison, sources, picked hotel's photo) — editable, Export as PDF.
  - **Turn this result into:** Presentation (hotel photo on the pick slide), Email, Map (places only), One-page summary.
  - **Complete node →** (says why when disabled).
- **Node complexity v2:** node brief, "Since your last visit", gate per level.
- Approval nodes keep their own view.

---

## 5. Workstream result

**Overall**
- **Generate the workstream result** works before every node is done (the AI estimates unfinished nodes, labelled as estimates).
- The result rebuilds itself from real outputs once the last node is done.
- Details adjusted on the canvas → **Update result** rebuilds it (a node's own hand-off is not changed).
- Missing something → the result names the node to reopen (Open button); it never adds groups.
- Formats made from the result show **Out of date** when it changes and rebuild automatically.
- **Approve and complete** stays locked until every node is really done.

**Chat**
- Rewrite a chapter, adjust a slide, move a day, "Which node does each part come from?", "Summarise the result in 3 lines".
- Change the interactive app ("On it — I'm changing the app…" → "See the app →"; every version kept).

**Cognitive Field**
- **About this node:** Right now (update, add a missing detail, or review).
- **Template:** one table per execution node with the details the result is built from (its output, or the AI's estimate) — reword, add or take out a detail, then **Update result**.
- **Inputs:** each deliverable with its done-when points (Met / Not met yet).
- **Graph component:** deliverables and nodes as a graph, Text, Sources.
- **Canvas:** post-its, cards, Explore more, voting, undo / redo (including your detail changes).

**Output**
- Progress per lane and node; Open next node.
- Generate the workstream result (notice names the estimated nodes).
- Result document (chapters, days, tables, slide blocks) + "How this was built".
- Rebuild from node outputs; Approve and complete.
- Export as PDF; Export the work so far (PDF / Markdown).
- **Output types (All outputs / Convert to):**

| Type | What it does |
|---|---|
| Document | The result itself |
| Presentation | Present, Export slides as PDF, photos and charts on slides |
| Email draft | Compose mock-up; nothing is sent |
| Map | Pins per day, Open in Google Maps (needs internet) |
| One-page summary | And other text forms |
| Interactive app | Runs live; Open in new tab, Download .html, Full screen, versions, change it in Chat |

---

## In every node

- Stepper navigation; each node keeps its own panel layout, graph, chat and canvas.
- 2-panel / 3-panel layout, resizable panels, light / dark, AI settings (key, model, OpenRouter or Tavily search).
- Highlight text in the Output's document → ✦ Ask AI (a reference tag in the chat box).
