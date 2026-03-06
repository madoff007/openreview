export interface SkillMetadata {
  content: string;
  description: string;
  name: string;
}

export const parseFrontmatter = (
  raw: string
): { body: string; description: string; name: string } => {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const [, frontmatter] = fmMatch ?? [];

  if (!frontmatter) {
    throw new Error("No frontmatter found");
  }

  const [, name] = frontmatter.match(/^name:\s*(.+)$/m) ?? [];
  const [, description] = frontmatter.match(/^description:\s*(.+)$/m) ?? [];

  if (!name || !description) {
    throw new Error("Missing name or description in frontmatter");
  }

  const bodyMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const body = bodyMatch ? raw.slice(bodyMatch[0].length).trim() : raw.trim();

  return {
    body,
    description: description.trim(),
    name: name.trim(),
  };
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
