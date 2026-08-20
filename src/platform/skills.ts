import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Skills hub — markdown skills shipped in `skills/` next to the project root.
 * Each skill is a markdown file with YAML frontmatter:
 *
 *   ---
 *   name: debugging
 *   description: ...
 *   category: Development
 *   version: 1.0.0
 *   ---
 *   ...body...
 */

export interface Skill {
  name: string;
  description: string;
  category: string;
  version: string;
  /** The full markdown body (frontmatter stripped). */
  content: string;
  file: string;
}

const DEFAULT_DIR = join(import.meta.dirname, "..", "..", "skills");

/** Parse `---\nkey: value\n---` frontmatter off a markdown file. */
function parseSkill(text: string, file: string): Skill | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  const name = meta.name;
  if (!name) return null;
  return {
    name,
    description: meta.description ?? "",
    category: meta.category ?? "General",
    version: meta.version ?? "1.0.0",
    content: match[2].trim(),
    file,
  };
}

/** Load every skill from the skills directory. */
export function loadSkills(dir: string = DEFAULT_DIR): Skill[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const entry of entries) {
    const text = readFileSync(join(dir, entry), "utf-8");
    const skill = parseSkill(text, entry);
    if (skill) skills.push(skill);
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** The set of skill names — used for the default "everything on" state. */
export function allSkillNames(skills: Skill[]): Set<string> {
  return new Set(skills.map((s) => s.name));
}
