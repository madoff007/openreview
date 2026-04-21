import "server-only";
import type { GitHubRawMessage } from "@chat-adapter/github";
import { createGitHubAdapter } from "@chat-adapter/github";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat, ThreadImpl, deriveChannelId, emoji } from "chat";
import type { Message, Thread } from "chat";
import { start } from "workflow/api";

import { env } from "@/lib/env";
import { botWorkflow } from "@/workflow";
import type { ThreadMessage, WorkflowParams } from "@/workflow";

import { getAppInfo, getInstallationOctokit } from "./github";

const collectMessages = async (
  thread: Thread<unknown, unknown>
): Promise<ThreadMessage[]> => {
  const messages: ThreadMessage[] = [];

  for await (const msg of thread.allMessages) {
    messages.push({
      content: msg.text,
      role: msg.author.isMe ? "assistant" : "user",
    });
  }

  return messages;
};

interface ThreadState {
  baseBranch: string;
  prBranch: string;
  prNumber: number;
  repoFullName: string;
}

interface PullRequestAutoReviewEvent {
  action: string;
  baseBranch: string;
  body?: string | null;
  draft?: boolean;
  prBranch: string;
  prNumber: number;
  repoFullName: string;
  title: string;
}

interface ManualReviewEvent {
  instruction?: string;
  prNumber: number;
  repoFullName: string;
}

const AUTO_REVIEW_ACTIONS = new Set([
  "opened",
  "ready_for_review",
  "reopened",
  "synchronize",
]);

const DEFAULT_MANUAL_REVIEW_INSTRUCTION =
  "Review only. Check for bugs, risky changes, regressions, and missing tests. Do not make code changes unless explicitly requested in the pull request thread.";

const state = env.REDIS_URL
  ? createRedisState({ url: env.REDIS_URL })
  : createMemoryState();

let botInstance: Chat | null = null;

const createThreadState = (
  baseBranch: string,
  prBranch: string,
  prNumber: number,
  repoFullName: string
): ThreadState => ({
  baseBranch,
  prBranch,
  prNumber,
  repoFullName,
});

const toStoredThreadState = (
  threadState: ThreadState
): Partial<Record<string, unknown>> =>
  threadState as unknown as Partial<Record<string, unknown>>;

const startReviewWorkflow = async (params: WorkflowParams): Promise<void> => {
  await start(botWorkflow, [params]);
};

const createPRThread = async (
  repoFullName: string,
  prNumber: number
): Promise<Thread<ThreadState>> => {
  const bot = await initBot();
  const adapter = bot.getAdapter("github");
  const [owner, repo] = repoFullName.split("/");
  const threadId = adapter.encodeThreadId({ owner, prNumber, repo });

  return new ThreadImpl<ThreadState>({
    adapter,
    channelId: deriveChannelId(adapter, threadId),
    id: threadId,
    stateAdapter: bot.getState(),
  });
};

const createAutoReviewMessages = ({
  action,
  body,
  title,
}: PullRequestAutoReviewEvent): ThreadMessage[] => [
  {
    content: `Automatically review this pull request after the GitHub \`pull_request.${action}\` event.

Review only. Check for bugs, risky changes, regressions, and missing tests.
Do not make code changes unless explicitly requested in this pull request thread.

PR title: ${title}

PR body:
${body?.trim() || "(empty)"}`,
    role: "user",
  },
];

const createManualReviewMessages = ({
  instruction,
  body,
  prNumber,
  title,
}: {
  body?: string | null;
  instruction?: string;
  prNumber: number;
  title: string;
}): ThreadMessage[] => [
  {
    content: `Manually review pull request #${prNumber}.

${instruction?.trim() || DEFAULT_MANUAL_REVIEW_INSTRUCTION}

PR title: ${title}

PR body:
${body?.trim() || "(empty)"}`,
    role: "user",
  },
];

const handleMention = async (thread: Thread, message: Message) => {
  await thread.adapter.addReaction(thread.id, message.id, emoji.eyes);

  const messages = await collectMessages(thread);
  const raw = message.raw as GitHubRawMessage;

  const repoFullName = raw.repository.full_name;
  const { prNumber } = raw;

  const octokit = await getInstallationOctokit();
  const [owner, repo] = repoFullName.split("/");

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    pull_number: prNumber,
    repo,
  });

  await thread.setState(
    toStoredThreadState(
      createThreadState(pr.base.ref, pr.head.ref, prNumber, repoFullName)
    )
  );

  await startReviewWorkflow({
    baseBranch: pr.base.ref,
    messages,
    prBranch: pr.head.ref,
    prNumber,
    repoFullName,
    threadId: thread.id,
  } satisfies WorkflowParams);
};

const initBot = async (): Promise<Chat> => {
  if (botInstance) {
    return botInstance;
  }

  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_APP_INSTALLATION_ID ||
    !env.GITHUB_APP_PRIVATE_KEY ||
    !env.GITHUB_APP_WEBHOOK_SECRET
  ) {
    throw new Error("Missing required GitHub App environment variables");
  }

  const appInfo = await getAppInfo();

  botInstance = new Chat({
    adapters: {
      github: createGitHubAdapter({
        appId: env.GITHUB_APP_ID,
        botUserId: appInfo.botUserId,
        installationId: env.GITHUB_APP_INSTALLATION_ID,
        privateKey: env.GITHUB_APP_PRIVATE_KEY.replaceAll("\\n", "\n"),
        userName: appInfo.slug,
        webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
      }),
    },
    logger: "debug",
    state,
    userName: appInfo.slug,
  });

  botInstance.onNewMention(handleMention);

  botInstance.onSubscribedMessage(async (thread, message) => {
    if (!message.isMention) {
      return;
    }

    await handleMention(thread, message);
  });

  botInstance.onReaction([emoji.thumbs_up, emoji.heart], async (event) => {
    if (!event.added || !event.message?.author.isMe) {
      return;
    }

    const threadState = (await event.thread.state) as ThreadState | null;

    if (!threadState) {
      return;
    }

    const messages = await collectMessages(event.thread);

    await startReviewWorkflow({
      ...threadState,
      messages,
      threadId: event.thread.id,
    } satisfies WorkflowParams);
  });

  botInstance.onReaction([emoji.thumbs_down, emoji.confused], async (event) => {
    if (!event.added || !event.message?.author.isMe) {
      return;
    }

    await event.thread.post(
      `${emoji.eyes} Got it, skipping that. Mention me with feedback if you'd like a different approach.`
    );
  });

  return botInstance;
};

export const handlePullRequestAutoReview = async ({
  action,
  baseBranch,
  body,
  draft,
  prBranch,
  prNumber,
  repoFullName,
  title,
}: PullRequestAutoReviewEvent): Promise<boolean> => {
  if (!AUTO_REVIEW_ACTIONS.has(action)) {
    return false;
  }

  if (draft && action !== "ready_for_review") {
    return false;
  }

  const thread = await createPRThread(repoFullName, prNumber);

  await thread.setState(
    toStoredThreadState(
      createThreadState(baseBranch, prBranch, prNumber, repoFullName)
    )
  );

  await startReviewWorkflow({
    baseBranch,
    messages: createAutoReviewMessages({
      action,
      baseBranch,
      body,
      draft,
      prBranch,
      prNumber,
      repoFullName,
      title,
    }),
    prBranch,
    prNumber,
    repoFullName,
    threadId: thread.id,
  } satisfies WorkflowParams);

  return true;
};

export const handleManualReview = async ({
  instruction,
  prNumber,
  repoFullName,
}: ManualReviewEvent): Promise<void> => {
  const octokit = await getInstallationOctokit();
  const [owner, repo] = repoFullName.split("/");

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    pull_number: prNumber,
    repo,
  });

  const thread = await createPRThread(repoFullName, prNumber);

  await thread.setState(
    toStoredThreadState(
      createThreadState(pr.base.ref, pr.head.ref, prNumber, repoFullName)
    )
  );

  await startReviewWorkflow({
    baseBranch: pr.base.ref,
    messages: createManualReviewMessages({
      body: pr.body,
      instruction,
      prNumber,
      title: pr.title,
    }),
    prBranch: pr.head.ref,
    prNumber,
    repoFullName,
    threadId: thread.id,
  } satisfies WorkflowParams);
};

export const getBot = (): Promise<Chat> => initBot();
