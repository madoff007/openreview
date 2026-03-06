import { tool } from "ai";
import { z } from "zod";

import type { SkillMetadata } from "@/lib/skills";

export const createLoadSkillTool = (skills: SkillMetadata[]) =>
  tool({
    description:
      "Load a skill to get specialized review instructions. Use this when the user's request matches an available skill.",
    execute: ({ name }) => {
      const skill = skills.find(
        (s) => s.name.toLowerCase() === name.toLowerCase()
      );

      if (!skill) {
        return {
          error: `Skill '${name}' not found. Available: ${skills.map((s) => s.name).join(", ")}`,
        };
      }

      return { content: skill.content };
    },
    inputSchema: z.object({
      name: z.string().describe("The skill name to load"),
    }),
  });
