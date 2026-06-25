import { db } from "../db.mjs";
import { mockupsForTarget } from "../mockups.mjs";
import { fetchRowOr404 } from "../fetch-helpers.mjs";
import { unprocessable } from "../http-errors.mjs";

function commentCounts() {
  const counts = new Map();
  for (const c of db.prepare("SELECT * FROM mockup_comments").all()) {
    const key = `${c.target_type}:${c.target_id}:${c.mockup_index}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

export function registerMockupAggregationRoutes(router) {
  router.get("/mockups", (req, res, params, query) => {
    const filters = [query.epic_id, query.story_id, query.task_id].filter(Boolean);
    if (filters.length !== 1) {
      throw unprocessable("specificare esattamente uno tra epic_id, story_id, task_id");
    }

    const counts = commentCounts();
    const results = [];

    if (query.task_id) {
      const task = fetchRowOr404("tasks", "task", query.task_id);
      results.push(...mockupsForTarget("task", task, counts));
    } else if (query.story_id) {
      const story = fetchRowOr404("stories", "story", query.story_id);
      results.push(...mockupsForTarget("story", story, counts));
      for (const t of db.prepare("SELECT * FROM tasks WHERE story_id = ?").all(story.id)) {
        results.push(...mockupsForTarget("task", t, counts));
      }
    } else {
      const epic = fetchRowOr404("epics", "epic", query.epic_id);
      results.push(...mockupsForTarget("epic", epic, counts));
      for (const s of db.prepare("SELECT * FROM stories WHERE epic_id = ?").all(epic.id)) {
        results.push(...mockupsForTarget("story", s, counts));
        for (const t of db.prepare("SELECT * FROM tasks WHERE story_id = ?").all(s.id)) {
          results.push(...mockupsForTarget("task", t, counts));
        }
      }
    }

    return { mockups: results };
  });
}
