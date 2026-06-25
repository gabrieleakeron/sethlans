import { countMockups } from "./mockups.mjs";

export function storyMockupDescendantCount(storyRow, taskRows) {
  return countMockups(storyRow.md) + taskRows.reduce((sum, t) => sum + countMockups(t.md), 0);
}

export function epicMockupDescendantCount(epicRow, storyRows, tasksByStory) {
  let total = countMockups(epicRow.md);
  for (const s of storyRows) {
    total += storyMockupDescendantCount(s, tasksByStory.get(s.id) || []);
  }
  return total;
}
