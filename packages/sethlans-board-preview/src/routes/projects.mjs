import { db, nowIso } from "../db.mjs";
import { newId } from "../ids.mjs";
import { validateEnum, TYPE_PROJECT } from "../enums.mjs";
import { rowToProject } from "../serializers.mjs";
import { fetchRowOr404 } from "../fetch-helpers.mjs";

export function registerProjectRoutes(router) {
  router.get("/projects", (req, res, params, query) => {
    let sql = "SELECT * FROM projects";
    const args = [];
    if (query.type) {
      sql += " WHERE type = ?";
      args.push(query.type);
    }
    const rows = db.prepare(sql).all(...args);
    return rows.map(rowToProject);
  });

  router.post("/projects", (req, res, params, query, body) => {
    validateEnum(body.type, TYPE_PROJECT, "type");
    const id = newId("p");
    const md = body.md || "";
    const mdUpdatedAt = md ? nowIso() : null;
    db.prepare(
      "INSERT INTO projects (id, name, type, jira_key, md, md_updated_at, config) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      body.name,
      body.type ?? "internal",
      body.jira_key ?? "",
      md,
      mdUpdatedAt,
      JSON.stringify(body.config ?? {})
    );
    return [201, rowToProject(fetchRowOr404("projects", "project", id))];
  });

  router.get("/projects/:project_id", (req, res, params) => {
    return rowToProject(fetchRowOr404("projects", "project", params.project_id));
  });

  router.patch("/projects/:project_id", (req, res, params, query, body) => {
    validateEnum(body.type, TYPE_PROJECT, "type");
    const row = fetchRowOr404("projects", "project", params.project_id);
    const fields = [];
    const args = [];
    for (const key of ["name", "type", "jira_key", "md"]) {
      if (body[key] !== undefined && body[key] !== null) {
        fields.push(`${key} = ?`);
        args.push(body[key]);
      }
    }
    if (body.config !== undefined && body.config !== null) {
      fields.push("config = ?");
      args.push(JSON.stringify(body.config));
    }
    if (body.md !== undefined && body.md !== null) {
      fields.push("md_updated_at = ?");
      args.push(nowIso());
    }
    if (fields.length > 0) {
      db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...args, row.id);
    }
    return rowToProject(fetchRowOr404("projects", "project", row.id));
  });

  router.delete("/projects/:project_id", (req, res, params) => {
    fetchRowOr404("projects", "project", params.project_id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(params.project_id);
    return { deleted: params.project_id };
  });
}
