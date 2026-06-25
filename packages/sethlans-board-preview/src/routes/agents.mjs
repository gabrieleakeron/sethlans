import { db } from "../db.mjs";
import { newId } from "../ids.mjs";
import { validateEnum, STATUS_AGENT } from "../enums.mjs";
import { rowToAgent } from "../serializers.mjs";
import { fetchRowOr404 } from "../fetch-helpers.mjs";

export function registerAgentRoutes(router) {
  router.get("/agents", (req, res, params, query) => {
    let sql = "SELECT * FROM agents";
    const args = [];
    if (query.status) {
      sql += " WHERE status = ?";
      args.push(query.status);
    }
    return db.prepare(sql).all(...args).map(rowToAgent);
  });

  router.post("/agents", (req, res, params, query, body) => {
    validateEnum(body.status, STATUS_AGENT);
    const id = newId("a");
    db.prepare(
      "INSERT INTO agents (id, name, current_task, status, tokens) VALUES (?, ?, ?, ?, ?)"
    ).run(id, body.name, body.current_task ?? "Inattivo", body.status ?? "idle", body.tokens ?? 0);
    return [201, rowToAgent(fetchRowOr404("agents", "agent", id))];
  });

  router.get("/agents/:agent_id", (req, res, params) => {
    return rowToAgent(fetchRowOr404("agents", "agent", params.agent_id));
  });

  router.patch("/agents/:agent_id", (req, res, params, query, body) => {
    validateEnum(body.status, STATUS_AGENT);
    const row = fetchRowOr404("agents", "agent", params.agent_id);
    const fields = [];
    const args = [];
    for (const key of ["name", "current_task", "status", "tokens"]) {
      if (body[key] !== undefined && body[key] !== null) {
        fields.push(`${key} = ?`);
        args.push(body[key]);
      }
    }
    if (fields.length > 0) {
      db.prepare(`UPDATE agents SET ${fields.join(", ")} WHERE id = ?`).run(...args, row.id);
    }
    return rowToAgent(fetchRowOr404("agents", "agent", row.id));
  });

  router.delete("/agents/:agent_id", (req, res, params) => {
    fetchRowOr404("agents", "agent", params.agent_id);
    db.prepare("DELETE FROM agents WHERE id = ?").run(params.agent_id);
    return { deleted: params.agent_id };
  });
}
