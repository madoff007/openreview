import { after, NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getBot, handlePullRequestAutoReview } from "@/lib/bot";
import { getGitHubApp } from "@/lib/github";

interface PullRequestWebhookPayload {
  action: string;
  number?: number;
  pull_request: {
    base: { ref: string };
    body?: string | null;
    draft?: boolean;
    head: { ref: string };
    number?: number;
    title: string;
  };
  repository: {
    full_name: string;
  };
}

export const POST = async (request: NextRequest): Promise<NextResponse> => {
  const eventType = request.headers.get("x-github-event");

  if (eventType === "pull_request") {
    const body = await request.text();
    const signature = request.headers.get("x-hub-signature-256");

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }

    const isValid = await getGitHubApp().webhooks.verify(body, signature);

    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: PullRequestWebhookPayload;

    try {
      payload = JSON.parse(body) as PullRequestWebhookPayload;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const prNumber = payload.number ?? payload.pull_request.number;

    if (!prNumber) {
      return NextResponse.json(
        { error: "Missing pull request number" },
        { status: 400 }
      );
    }

    after(async () => {
      await handlePullRequestAutoReview({
        action: payload.action,
        baseBranch: payload.pull_request.base.ref,
        body: payload.pull_request.body,
        draft: payload.pull_request.draft,
        prBranch: payload.pull_request.head.ref,
        prNumber,
        repoFullName: payload.repository.full_name,
        title: payload.pull_request.title,
      });
    });

    return NextResponse.json({ ok: true });
  }

  const bot = await getBot();
  const handler = bot.webhooks.github;

  if (!handler) {
    return NextResponse.json(
      { error: "GitHub adapter not configured" },
      { status: 404 }
    );
  }

  return handler(request, {
    waitUntil: (task) => after(() => task),
  }) as Promise<NextResponse>;
};
