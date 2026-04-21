import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { handleManualReview } from "@/lib/bot";
import { env } from "@/lib/env";

interface ManualReviewRequestBody {
  instruction?: string;
  prNumber?: number;
  repoFullName?: string;
}

const getRequestToken = (request: NextRequest): string | null => {
  const bearer = request.headers.get("authorization");

  if (bearer?.startsWith("Bearer ")) {
    return bearer.slice("Bearer ".length).trim();
  }

  return request.headers.get("x-openreview-token")?.trim() || null;
};

const hasValidToken = (
  providedToken: string | null,
  expectedToken: string | undefined
): boolean => {
  if (!providedToken || !expectedToken) {
    return false;
  }

  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
};

export const POST = async (request: NextRequest): Promise<NextResponse> => {
  if (!env.OPENREVIEW_TRIGGER_TOKEN) {
    return NextResponse.json(
      { error: "Manual review trigger is not configured" },
      { status: 503 }
    );
  }

  if (!hasValidToken(getRequestToken(request), env.OPENREVIEW_TRIGGER_TOKEN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ManualReviewRequestBody;

  try {
    body = (await request.json()) as ManualReviewRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const repoFullName = body.repoFullName?.trim();
  const prNumber = Number(body.prNumber);
  const instruction = body.instruction?.trim();

  if (!repoFullName) {
    return NextResponse.json(
      { error: "Missing repoFullName" },
      { status: 400 }
    );
  }

  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return NextResponse.json({ error: "Invalid prNumber" }, { status: 400 });
  }

  await handleManualReview({
    instruction,
    prNumber,
    repoFullName,
  });

  return NextResponse.json({
    accepted: true,
    mode: "review-only",
    prNumber,
    repoFullName,
  });
};
