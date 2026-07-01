import { unprocessable } from "./http-errors.mjs";

export const STATUS_WORK = new Set(["todo", "progress", "done"]);
export const STATUS_AGENT = new Set(["active", "idle"]);
export const PHASE_STORY = new Set(["analysis", "ux", "design", "dev", "done"]);
export const TYPE_PROJECT = new Set(["jira", "internal"]);
export const TARGET_COMMENT = new Set(["story", "task"]);
export const ROLE_KNOWLEDGE = new Set([
  "general", "po", "seth-architect", "ux", "seth-tester",
  "seth-frontend", "seth-be-python", "seth-be-java", "seth-fullstack", "seth-reviewer", "seth-devops",
]);
export const KIND_KNOWLEDGE = new Set(["profile", "kb", "learnings", "standards"]);
export const SOURCE_KNOWLEDGE = new Set(["claude_md", "confluence", "jira", "code", "manual"]);

export function validateEnum(value, allowed, field = "status") {
  if (value !== null && value !== undefined && !allowed.has(value)) {
    throw unprocessable(`${field} non valido: deve essere uno tra ${[...allowed].sort().join(", ")}`);
  }
}
