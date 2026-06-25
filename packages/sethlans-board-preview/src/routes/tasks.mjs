import { db, nowIso } from "../db.mjs";
import { newId } from "../ids.mjs";
import { validateEnum, STATUS_WORK } from "../enums.mjs";
import { rowToTask } from "../serializers.mjs";
import { fetchRowOr404 } from "../fetch-helpers.mjs";

export function registerTaskRoutes(router) {
  router.get("/tasks", (req, res, params, query) => {
    let sql = "SELECT * FROM tasks";
    const conds = [];
    const args = [];
    if (query.story_id) {
      conds.push("story_id = ?");
      args.push(query.story_id);
    }
    if (query.status) {
      conds.push("status = ?");
      args.push(query.status);
    }
    if (query.agent_id) {
      conds.push("agent_id = ?");
      args.push(query.agent_id);
    }
    if (conds.length) sql += " WHERE " + conds.join(" AND ");
    const rows = db.prepare(sql).all(...args);
    return rows.map(rowToTask);
  });

  router.post("/tasks", (req, res, params, query, body) => {
    validateEnum(body.status, STATUS_WORK);
    fetchRowOr404("stories", "story", body.story_id);
    if (body.agent_id) {
      fetchRowOr404("agents", "agent", body.agent_id);
    }
    const id = newId("t");
    const md = body.md || "";
    db.prepare(
      "INSERT INTO tasks (id, title, status, story_id, agent_id, md, md_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, body.title, body.status ?? "todo", body.story_id, body.agent_id ?? null, md, md ? nowIso() : null);
    return [201, rowToTask(fetchRowOr404("tasks", "task", id))];
  });

  router.get("/tasks/:task_id", (req, res, params) => {
    return rowToTask(fetchRowOr404("tasks", "task", params.task_id));
  });

  router.patch("/tasks/:task_id", (req, res, params, query, body) => {
    validateEnum(body.status, STATUS_WORK);
    const row = fetchRowOr404("tasks", "task", params.task_id);
    if (body.story_id !== undefined && body.story_id !== null) {
      fetchRowOr404("stories", "story", body.story_id);
    }
    if (body.agent_id !== undefined && body.agent_id !== null && body.agent_id !== "") {
      fetchRowOr404("agents", "agent", body.agent_id);
    }
    const fields = [];
    const args = [];
    for (const key of ["title", "status", "story_id", "agent_id", "md"]) {
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
      db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...args, row.id);
    }
    return rowToTask(fetchRowOr404("tasks", "task", row.id));
  });

  router.delete("/tasks/:task_id", (req, res, params) => {
    fetchRowOr404("tasks", "task", params.task_id);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(params.task_id);
    return { deleted: params.task_id };
  });
}
