import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { tool } from "ai";
import { z } from "zod";

import type { SkillMetadata } from "@/lib/skills";
import { stripFrontmatter } from "@/lib/skills";

export const createLoadSkillTool = (skills: SkillMetadata[]) =>
  tool({
    description:
      "Load a skill to get specialized review instructions. Use this when the user's request matches an available skill.",
    execute: async ({ name }) => {
      const skill = skills.find(
        (s) => s.name.toLowerCase() === name.toLowerCase()
      );

      if (!skill) {
        return {
          error: `Skill '${name}' not found. Available: ${skills.map((s) => s.name).join(", ")}`,
        };
      }

      const skillFile = join(skill.path, "SKILL.md");
      const content = await readFile(skillFile, "utf8");
      const body = stripFrontmatter(content);

      return {
        content: body,
        skillDirectory: skill.path,
      };
    },
    inputSchema: z.object({
      name: z.string().describe("The skill name to load"),
    }),
  });
