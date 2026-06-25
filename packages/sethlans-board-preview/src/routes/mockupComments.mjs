import { db, nowIso } from "../db.mjs";
import { newId } from "../ids.mjs";
import { validateEnum, TARGET_COMMENT } from "../enums.mjs";
import { rowToMockupComment } from "../serializers.mjs";
import { fetchRowOr404 } from "../fetch-helpers.mjs";
import { unprocessable } from "../http-errors.mjs";

const MAX_COMMENT_IMAGE_BYTES = 2 * 1024 * 1024;
const DATA_URI_IMAGE_PREFIX_RE = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

function validateCommentImage(image) {
  if (image === undefined || image === null) return;
  if (!DATA_URI_IMAGE_PREFIX_RE.test(image)) {
    throw unprocessable("image deve essere una data URI con prefisso 'data:image/'");
  }
  const b64Payload = image.includes(",") ? image.split(",", 2)[1] : "";
  let decoded;
  try {
    decoded = Buffer.from(b64Payload, "base64");
  } catch {
    throw unprocessable("image non è base64 valido");
  }
  if (decoded.length > MAX_COMMENT_IMAGE_BYTES) {
    throw unprocessable(`image supera il limite di ${MAX_COMMENT_IMAGE_BYTES} byte`);
  }
}

function fetchCommentTarget(targetType, targetId) {
  const table = targetType === "story" ? "stories" : "tasks";
  const kind = targetType === "story" ? "story" : "task";
  fetchRowOr404(table, kind, targetId);
}

export function registerMockupCommentRoutes(router) {
  router.get("/mockup-comments", (req, res, params, query) => {
    validateEnum(query.target_type, TARGET_COMMENT, "target_type");
    let sql = "SELECT * FROM mockup_comments";
    const conds = [];
    const args = [];
    if (query.target_type) {
      conds.push("target_type = ?");
      args.push(query.target_type);
    }
    if (query.target_id) {
      conds.push("target_id = ?");
      args.push(query.target_id);
    }
    if (query.mockup_index !== undefined) {
      conds.push("mockup_index = ?");
      args.push(Number(query.mockup_index));
    }
    if (conds.length) sql += " WHERE " + conds.join(" AND ");
    sql += " ORDER BY created_at ASC";
    return db.prepare(sql).all(...args).map(rowToMockupComment);
  });

  router.post("/mockup-comments", (req, res, params, query, body) => {
    validateEnum(body.target_type, TARGET_COMMENT, "target_type");
    fetchCommentTarget(body.target_type, body.target_id);
    if (body.mockup_index < 0) {
      throw unprocessable("mockup_index deve essere >= 0");
    }
    if (!(body.text || "").trim() && !body.image) {
      throw unprocessable("specificare almeno uno tra text e image");
    }
    validateCommentImage(body.image);
    const id = newId("c");
    db.prepare(
      "INSERT INTO mockup_comments (id, target_type, target_id, mockup_index, author, text, image, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      body.target_type,
      body.target_id,
      body.mockup_index,
      body.author || "user",
      body.text || "",
      body.image ?? null,
      nowIso()
    );
    return [201, rowToMockupComment(fetchRowOr404("mockup_comments", "mockup_comment", id))];
  });

  router.delete("/mockup-comments/:comment_id", (req, res, params) => {
    fetchRowOr404("mockup_comments", "mockup_comment", params.comment_id);
    db.prepare("DELETE FROM mockup_comments WHERE id = ?").run(params.comment_id);
    return { deleted: params.comment_id };
  });
}
