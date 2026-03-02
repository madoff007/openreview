import { tool } from "ai";
import { z } from "zod";

import { addPRComment } from "@/workflow/steps/add-pr-comment";

const replyStep = async (
  threadId: string,
  body: string
): Promise<{ success: boolean }> => {
  "use step";

  await addPRComment(threadId, body);
  return { success: true };
};

export const createReplyTool = (threadId: string) =>
  tool({
    description:
      "Post a comment on the pull request. Use this to share your findings, ask questions, or report results.",
    execute: ({ body }) => replyStep(threadId, body),
    inputSchema: z.object({
      body: z.string().describe("The markdown-formatted comment body to post"),
    }),
  });
