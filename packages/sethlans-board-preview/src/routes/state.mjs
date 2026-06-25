import { db } from "../db.mjs";
import { rowToProject, rowToEpic, rowToStory, rowToTask, rowToAgent, rowToKnowledge, rowToMockupComment } from "../serializers.mjs";
import { epicMockupDescendantCount, storyMockupDescendantCount } from "../derived.mjs";

export function registerStateRoutes(router) {
  router.get("/state", () => {
    const epics = db.prepare("SELECT * FROM epics").all();
    const stories = db.prepare("SELECT * FROM stories").all();
    const tasks = db.prepare("SELECT * FROM tasks").all();

    const tasksByStory = new Map();
    for (const t of tasks) {
      if (!tasksByStory.has(t.story_id)) tasksByStory.set(t.story_id, []);
      tasksByStory.get(t.story_id).push(t);
    }
    const storiesByEpic = new Map();
    for (const s of stories) {
      if (!storiesByEpic.has(s.epic_id)) storiesByEpic.set(s.epic_id, []);
      storiesByEpic.get(s.epic_id).push(s);
    }

    return {
      projects: db.prepare("SELECT * FROM projects").all().map(rowToProject),
      epics: epics.map((e) =>
        rowToEpic(e, epicMockupDescendantCount(e, storiesByEpic.get(e.id) || [], tasksByStory))
      ),
      stories: stories.map((s) => rowToStory(s, storyMockupDescendantCount(s, tasksByStory.get(s.id) || []))),
      tasks: tasks.map(rowToTask),
      agents: db.prepare("SELECT * FROM agents").all().map(rowToAgent),
      knowledge: db.prepare("SELECT * FROM knowledge").all().map(rowToKnowledge),
      mockup_comments: db.prepare("SELECT * FROM mockup_comments").all().map(rowToMockupComment),
    };
  });
}
