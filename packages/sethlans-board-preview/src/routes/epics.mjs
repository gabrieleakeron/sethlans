import { db, nowIso } from "../db.mjs";
import { newId } from "../ids.mjs";
import { validateEnum, STATUS_WORK } from "../enums.mjs";
import { rowToEpic } from "../serializers.mjs";
import { fetchRowOr404 } from "../fetch-helpers.mjs";
import { epicMockupDescendantCount } from "../derived.mjs";

function epicToDict(epicRow) {
  const stories = db.prepare("SELECT * FROM stories WHERE epic_id = ?").all(epicRow.id);
  const storyIds = stories.map((s) => s.id);
  const tasksByStory = new Map(storyIds.map((id) => [id, []]));
  if (storyIds.length > 0) {
    const placeholders = storyIds.map(() => "?").join(", ");
    const tasks = db.prepare(`SELECT * FROM tasks WHERE story_id IN (${placeholders})`).all(...storyIds);
    for (const t of tasks) {
      if (!tasksByStory.has(t.story_id)) tasksByStory.set(t.story_id, []);
      tasksByStory.get(t.story_id).push(t);
    }
  }
  return rowToEpic(epicRow, epicMockupDescendantCount(epicRow, stories, tasksByStory));
}

export function registerEpicRoutes(router) {
  router.get("/epics", (req, res, params, query) => {
    let sql = "SELECT * FROM epics";
    const conds = [];
    const args = [];
    if (query.status) {
      conds.push("status = ?");
      args.push(query.status);
    }
    if (query.project_id) {
      conds.push("project_id = ?");
      args.push(query.project_id);
    }
    if (conds.length) sql += " WHERE " + conds.join(" AND ");
    const rows = db.prepare(sql).all(...args);
    return rows.map(epicToDict);
  });

  router.post("/epics", (req, res, params, query, body) => {
    validateEnum(body.status, STATUS_WORK);
    fetchRowOr404("projects", "project", body.project_id);
    const id = newId("e");
    const md = body.md || "";
    db.prepare(
      "INSERT INTO epics (id, title, desc, status, project_id, md, md_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, body.title, body.desc ?? "", body.status ?? "todo", body.project_id, md, md ? nowIso() : null);
    return [201, epicToDict(fetchRowOr404("epics", "epic", id))];
  });

  router.get("/epics/:epic_id", (req, res, params) => {
    return epicToDict(fetchRowOr404("epics", "epic", params.epic_id));
  });

  router.patch("/epics/:epic_id", (req, res, params, query, body) => {
    validateEnum(body.status, STATUS_WORK);
    const row = fetchRowOr404("epics", "epic", params.epic_id);
    if (body.project_id !== undefined && body.project_id !== null) {
      fetchRowOr404("projects", "project", body.project_id);
    }
    const fields = [];
    const args = [];
    for (const key of ["title", "desc", "status", "project_id", "md"]) {
      if (body[key] !== undefined && body[key] !== null) {
        fields.push(`${key} = ?`);
        args.push(body[key]);
      }
    }
    if (body.md !== undefined && body.md !== null) {
      fields.push("md_updated_at = ?");
      args.push(nowIso());
    }
    if (fields.length > 0) {
      db.prepare(`UPDATE epics SET ${fields.join(", ")} WHERE id = ?`).run(...args, row.id);
    }
    return epicToDict(fetchRowOr404("epics", "epic", row.id));
  });

  router.delete("/epics/:epic_id", (req, res, params) => {
    fetchRowOr404("epics", "epic", params.epic_id);
    db.prepare("DELETE FROM epics WHERE id = ?").run(params.epic_id);
    return { deleted: params.epic_id };
  });
}

export { epicToDict };
