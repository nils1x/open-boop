import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const SKILL_EXT = ".md";
let cache: Map<string, string> | null = null;

function loadAll(): Map<string, string> {
  if (cache) return cache;
  cache = new Map();

  let files: string[];
  try {
    files = readdirSync(here).filter((f) => f.endsWith(SKILL_EXT));
  } catch {
    return cache;
  }

  for (const file of files) {
    const name = file.slice(0, -SKILL_EXT.length);
    const content = readFileSync(resolve(here, file), "utf-8");
    // Strip frontmatter if present (YAML between --- lines)
    const body = content.replace(/^---[\s\S]*?---\n?/, "");
    cache.set(name, body.trim());
  }

  return cache;
}

export function listSkills(): string[] {
  return [...loadAll().keys()].sort();
}

export function buildSkillPrompt(names: string[]): string {
  const all = loadAll();
  const parts: string[] = [];

  for (const name of names) {
    const content = all.get(name);
    if (content) {
      parts.push(content);
    } else {
      console.warn(`[skills] unknown skill: "${name}" — available: ${listSkills().join(", ") || "(none)"}`);
    }
  }

  return parts.join("\n\n---\n\n");
}

// Called once at boot to pre-warm the cache
export function preloadSkills(): void {
  const skills = listSkills();
  if (skills.length > 0) {
    console.log(`[skills] loaded: ${skills.join(", ")}`);
  } else {
    console.log("[skills] no skills found — drop .md files into server/skills/");
  }
}
