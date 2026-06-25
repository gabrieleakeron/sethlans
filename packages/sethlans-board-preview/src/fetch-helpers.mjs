import { db } from "./db.mjs";
import { notFound } from "./http-errors.mjs";

export function fetchRowOr404(table, kind, id) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw notFound(kind, id);
  return row;
}
