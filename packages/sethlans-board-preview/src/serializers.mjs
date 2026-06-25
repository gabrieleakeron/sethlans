import { countMockups } from "./mockups.mjs";

export function rowToProject(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    jira_key: row.jira_key || "",
    md: row.md || "",
    md_updated_at: row.md_updated_at || null,
    config: row.config ? JSON.parse(row.config) : {},
  };
}

export function rowToEpic(row, mockupDescendantCount = 0) {
  return {
    id: row.id,
    title: row.title,
    desc: row.desc || "",
    status: row.status,
    project_id: row.project_id,
    md: row.md || "",
    md_updated_at: row.md_updated_at || null,
    mockup_descendant_count: mockupDescendantCount,
  };
}

export function rowToStory(row, mockupDescendantCount = null) {
  const own = countMockups(row.md);
  return {
    id: row.id,
    title: row.title,
    desc: row.desc || "",
    status: row.status,
    phase: row.phase,
    epic_id: row.epic_id,
    md: row.md || "",
    md_updated_at: row.md_updated_at || null,
    mockup_count: own,
    mockup_descendant_count: mockupDescendantCount === null ? own : mockupDescendantCount,
  };
}

export function rowToTask(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    story_id: row.story_id,
    agent_id: row.agent_id || null,
    md: row.md || "",
    md_updated_at: row.md_updated_at || null,
    mockup_count: countMockups(row.md),
  };
}

export function rowToAgent(row) {
  return {
    id: row.id,
    name: row.name,
    current_task: row.current_task,
    status: row.status,
    tokens: row.tokens,
  };
}

export function rowToKnowledge(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    role: row.role,
    kind: row.kind,
    title: row.title,
    source: row.source,
    md: row.md || "",
    md_updated_at: row.md_updated_at || null,
  };
}

export function rowToMockupComment(row) {
  return {
    id: row.id,
    target_type: row.target_type,
    target_id: row.target_id,
    mockup_index: row.mockup_index,
    author: row.author,
    text: row.text || "",
    image: row.image || null,
    created_at: row.created_at || null,
  };
}
