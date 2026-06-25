// Regex dei blocchi ```mockup``` — deve rispecchiare MOCKUP_BLOCK_RE in
// packages/sethlans-board/backend/models.py per restare coerente (conteggio + estrazione).
const MOCKUP_BLOCK_SOURCE = "```mockup\\s*([\\s\\S]*?)```";
const HEADING_SOURCE = "^(#{1,4})\\s+(.*)$";

// Le istanze con flag "g"/"m" mantengono uno stato (lastIndex): se ne crea una nuova ad ogni
// chiamata invece di condividerla, per evitare bug di stato tra richieste concorrenti gestite
// dallo stesso processo Node.
export function countMockups(md) {
  if (!md) return 0;
  const re = new RegExp(MOCKUP_BLOCK_SOURCE, "g");
  return [...md.matchAll(re)].length;
}

export function mockupBlocks(md) {
  if (!md) return [];
  const re = new RegExp(MOCKUP_BLOCK_SOURCE, "g");
  return [...md.matchAll(re)];
}

function mockupName(md, blockStart, targetTitle, index) {
  const re = new RegExp(HEADING_SOURCE, "gm");
  let lastHeading = null;
  let m;
  while ((m = re.exec(md)) !== null) {
    if (m.index >= blockStart) break;
    lastHeading = m[2].trim();
  }
  return lastHeading || `${targetTitle} — mockup #${index}`;
}

export function mockupsForTarget(targetType, targetObj, commentCounts) {
  const md = targetObj.md || "";
  const items = [];
  mockupBlocks(md).forEach((match, idx) => {
    const key = `${targetType}:${targetObj.id}:${idx}`;
    items.push({
      target_type: targetType,
      target_id: targetObj.id,
      target_title: targetObj.title,
      mockup_index: idx,
      name: mockupName(md, match.index, targetObj.title, idx),
      comment_count: commentCounts.get(key) || 0,
    });
  });
  return items;
}
