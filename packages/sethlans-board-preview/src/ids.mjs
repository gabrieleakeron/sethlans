import { randomUUID } from "node:crypto";

export function newId(prefix) {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}
