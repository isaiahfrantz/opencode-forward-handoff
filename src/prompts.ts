export const buildGeneratorPrompt = (current: number, limit: number) =>
  [
    `CONTEXT BUDGET REACHED (${current}/${limit} tokens). Halt all tool calls and file edits immediately.`,
    "Output ONLY the structured markdown block below under 1,200 tokens. Do not include conversational filler.",
    "",
    "# SESSION HANDOFF ARTIFACT",
    "",
    "## 1. Primary Objective & Acceptance Criteria",
    "- **Goal:** [1-2 sentences defining the exact feature, bugfix, or refactor]",
    "- **Done When:** [Exact test command or observable behavior required to close the task]",
    "",
    "## 2. Verified Progress (Completed)",
    "- [path/to/file.ext:L10-L45] — [Exact change made and verified]",
    "",
    "## 3. Negative Constraints (DO NOT REPEAT)",
    "- **Failed Approach:** [What was tried] -> **Why it failed:** [Exact error or architectural conflict]",
    "- **Invariants:** [Architectural rules or signatures that must not change]",
    "",
    "## 4. Active File & Symbol Map",
    "- [path/to/target.ext] (Lines X–Y): [Role of file and functions to inspect/edit next]",
    "- [path/to/test.ext]: [Isolated verification command]",
    "",
    "## 5. Immediate Next Step (Atomic)",
    "1. [Single, concrete first action for the next session]",
  ].join("\n")

export const buildResumePrompt = (artifact: string) =>
  [
    "You are resuming an in-progress engineering task inside a fresh, clean context window.",
    "",
    "### Operating Rules for This Session",
    "1. **Trust the Handoff:** Do NOT run broad repository searches (grep, find, or reading entire files) for items already mapped in Section 2 or Section 4.",
    "2. **Respect Negative Constraints:** Strictly avoid every failed approach listed in Section 3.",
    "3. **Scoped Reads Only:** Only read the specific file paths and line ranges listed in Section 4.",
    "4. **Execute Immediately:** Begin directly with **Step 1** in Section 5 without summarizing this prompt back to me.",
    "",
    "### Handoff Payload",
    artifact,
  ].join("\n")

/**
 * Soft-limit nudge: injected (once) while occupancy sits between the soft
 * limit and the hard gate. Visible synthetic message — the agent keeps
 * working but should start winding down.
 */
export const buildGraceWarning = (current: number, softLimit: number, hardLimit: number) =>
  [
    `[handoff] CONTEXT APPROACHING LIMIT (${current}/${hardLimit} tokens; soft limit ${softLimit}).`,
    "Start wrapping up: finish the unit of work you are inside, avoid starting new multi-step explorations,",
    "and prefer targeted reads over broad ones. A forced context handoff triggers at the hard limit.",
  ].join(" ")

/**
 * Injected when the hard gate defers the handoff because the session is at a
 * safe boundary (no pending modifications / todo list complete). The agent may
 * keep going; the handoff is forced at the next state-changing step.
 */
export const buildDeferralNote = (current: number, hardLimit: number) =>
  [
    `[handoff] CONTEXT LIMIT REACHED (${current}/${hardLimit} tokens), handoff deferred: the session is at a ` +
      "safe boundary (no pending modifications, all tracked todos completed). Only read-only or finalizing steps " +
      "are allowed — the forced handoff summary will be requested at the next state-changing step.",
  ].join(" ")


