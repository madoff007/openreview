import { APICallError } from "@ai-sdk/provider";
import { RetryError } from "ai";

const MAX_ERROR_TEXT_LENGTH = 4000;
const MAX_ERROR_DEPTH = 3;

const truncate = (value: string): string =>
  value.length <= MAX_ERROR_TEXT_LENGTH
    ? value
    : `${value.slice(0, MAX_ERROR_TEXT_LENGTH)}\n... (truncated ${value.length - MAX_ERROR_TEXT_LENGTH} chars)`;

const stringifyValue = (value: unknown): string => {
  if (typeof value === "string") {
    return truncate(value);
  }

  try {
    return truncate(JSON.stringify(value, null, 2));
  } catch {
    return truncate(String(value));
  }
};

const indent = (value: string): string =>
  value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

const formatLines = (
  title: string,
  fields: [label: string, value: string | number | boolean | undefined][]
): string =>
  [
    title,
    ...fields
      .filter(([, value]) => value !== undefined)
      .map(([label, value]) => `- ${label}: ${String(value)}`),
  ].join("\n");

export const parseError = function parseError(
  error: unknown,
  depth = 0
): string {
  const formatNestedError = (nestedError: unknown): string => {
    if (depth >= MAX_ERROR_DEPTH) {
      return "[error details truncated]";
    }

    return indent(parseError(nestedError, depth + 1));
  };

  if (RetryError.isInstance(error)) {
    return formatLines(`RetryError: ${error.message}`, [
      ["reason", error.reason],
      ["attempts", error.errors.length],
      [
        "lastError",
        error.lastError === undefined
          ? undefined
          : `\n${formatNestedError(error.lastError)}`,
      ],
    ]);
  }

  if (APICallError.isInstance(error)) {
    return formatLines(`APICallError: ${error.message}`, [
      ["url", error.url],
      ["statusCode", error.statusCode],
      ["isRetryable", error.isRetryable],
      [
        "data",
        error.data === undefined
          ? undefined
          : `\n${indent(stringifyValue(error.data))}`,
      ],
      [
        "responseBody",
        error.responseBody === undefined || error.responseBody === null
          ? undefined
          : `\n${indent(stringifyValue(error.responseBody))}`,
      ],
    ]);
  }

  if (error instanceof Error) {
    const errorWithCause = error as Error & { cause?: unknown };

    return formatLines(`${error.name}: ${error.message}`, [
      [
        "cause",
        errorWithCause.cause === undefined
          ? undefined
          : `\n${formatNestedError(errorWithCause.cause)}`,
      ],
    ]);
  }

  return stringifyValue(error);
};
