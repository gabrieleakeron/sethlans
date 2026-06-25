import { db, nowIso } from "../db.mjs";
import { newId } from "../ids.mjs";
import { validateEnum, ROLE_KNOWLEDGE, KIND_KNOWLEDGE, SOURCE_KNOWLEDGE } from "../enums.mjs";
import { rowToKnowledge } from "../serializers.mjs";
import { fetchRowOr404 } from "../fetch-helpers.mjs";

export function registerKnowledgeRoutes(router) {
  router.get("/knowledge", (req, res, params, query) => {
    let sql = "SELECT * FROM knowledge";
    const conds = [];
    const args = [];
    if (query.project_id) {
      conds.push("project_id = ?");
      args.push(query.project_id);
    }
    if (query.role) {
      conds.push("role = ?");
      args.push(query.role);
    }
    if (query.kind) {
      conds.push("kind = ?");
      args.push(query.kind);
    }
    if (conds.length) sql += " WHERE " + conds.join(" AND ");
    return db.prepare(sql).all(...args).map(rowToKnowledge);
  });

  router.post("/knowledge", (req, res, params, query, body) => {
    validateEnum(body.role, ROLE_KNOWLEDGE, "role");
    validateEnum(body.kind, KIND_KNOWLEDGE, "kind");
    validateEnum(body.source, SOURCE_KNOWLEDGE, "source");
    fetchRowOr404("projects", "project", body.project_id);
    const id = newId("k");
    const md = body.md || "";
    db.prepare(
      "INSERT INTO knowledge (id, project_id, role, kind, title, source, md, md_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      body.project_id,
      body.role ?? "general",
      body.kind ?? "kb",
      body.title,
      body.source ?? "manual",
      md,
      md ? nowIso() : null
    );
    return [201, rowToKnowledge(fetchRowOr404("knowledge", "knowledge", id))];
  });

  router.get("/knowledge/:knowledge_id", (req, res, params) => {
    return rowToKnowledge(fetchRowOr404("knowledge", "knowledge", params.knowledge_id));
  });

  router.patch("/knowledge/:knowledge_id", (req, res, params, query, body) => {
    validateEnum(body.role, ROLE_KNOWLEDGE, "role");
    validateEnum(body.kind, KIND_KNOWLEDGE, "kind");
    validateEnum(body.source, SOURCE_KNOWLEDGE, "source");
    const row = fetchRowOr404("knowledge", "knowledge", params.knowledge_id);
    const fields = [];
    const args = [];
    for (const key of ["title", "role", "kind", "source", "md"]) {
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
      db.prepare(`UPDATE knowledge SET ${fields.join(", ")} WHERE id = ?`).run(...args, row.id);
    }
    return rowToKnowledge(fetchRowOr404("knowledge", "knowledge", row.id));
  });

  router.delete("/knowledge/:knowledge_id", (req, res, params) => {
    fetchRowOr404("knowledge", "knowledge", params.knowledge_id);
    db.prepare("DELETE FROM knowledge WHERE id = ?").run(params.knowledge_id);
    return { deleted: params.knowledge_id };
  });
}
