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

