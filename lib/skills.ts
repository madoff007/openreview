import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SkillMetadata {
  description: string;
  name: string;
  path: string;
}

const parseFrontmatter = (
  content: string
): { description: string; name: string } => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  const [, frontmatter] = match ?? [];

  if (!frontmatter) {
    throw new Error("No frontmatter found");
  }

  const [, name] = frontmatter.match(/^name:\s*(.+)$/m) ?? [];
  const [, description] = frontmatter.match(/^description:\s*(.+)$/m) ?? [];

  if (!name || !description) {
    throw new Error("Missing name or description in frontmatter");
  }

  return {
    description: description.trim(),
    name: name.trim(),
  };
};

export const stripFrontmatter = (content: string): string => {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length).trim() : content.trim();
};

export const discoverSkills = async (
  directories: string[]
): Promise<SkillMetadata[]> => {
  const skills: SkillMetadata[] = [];
  const seenNames = new Set<string>();

  for (const dir of directories) {
    let entries;

    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDir = join(dir, entry.name);
      const skillFile = join(skillDir, "SKILL.md");

      try {
        const content = await readFile(skillFile, "utf8");
        const frontmatter = parseFrontmatter(content);

        if (seenNames.has(frontmatter.name)) {
          continue;
        }

        seenNames.add(frontmatter.name);

        skills.push({
          description: frontmatter.description,
          name: frontmatter.name,
          path: skillDir,
        });
      } catch {
        continue;
      }
    }
  }

  return skills;
};

export const buildSkillsPrompt = (skills: SkillMetadata[]): string => {
  if (skills.length === 0) {
    return "";
  }

  const skillsList = skills
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join("\n");

  return `## Skills

Use the \`loadSkill\` tool to load a skill when the user's request would benefit from specialized instructions. Only the skill names and descriptions are shown here — load a skill to get the full instructions.

Available skills:
${skillsList}`;
};
