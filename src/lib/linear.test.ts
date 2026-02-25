import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { LinearClient } from "@linear/sdk";
import type { LinearIds } from "./config";
import { countIssuesInState, setClientForTesting } from "./linear";

// ---------------------------------------------------------------------------
// Mock response type and helpers
// ---------------------------------------------------------------------------

interface MockRawResponse {
  data: {
    issues: {
      nodes: { id: string }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
}

function makeRawResponse(
  nodeCount: number,
  hasNextPage: boolean,
  endCursor: string | null,
): MockRawResponse {
  return {
    data: {
      issues: {
        nodes: Array.from({ length: nodeCount }, (_, i) => ({
          id: `item-${i}`,
        })),
        pageInfo: { hasNextPage, endCursor },
      },
    },
  };
}

// Sequential call tracking: each invocation of mockRawRequest pops from this array.
let rawCallCount = 0;
let rawResponses: Array<MockRawResponse | Error> = [];

const mockRawRequest = mock(async () => {
  const resp = rawResponses[rawCallCount++];
  if (resp instanceof Error) throw resp;
  return resp;
});

const TEST_IDS: LinearIds = {
  teamId: "team-1",
  teamKey: "ENG",
  projectId: "proj-1",
  projectName: "test",
  states: {
    triage: "s1",
    ready: "s2",
    in_progress: "s3",
    in_review: "s4",
    done: "s5",
    blocked: "s6",
  },
};

// ---------------------------------------------------------------------------
// countIssuesInState
// ---------------------------------------------------------------------------

describe("countIssuesInState", () => {
  beforeEach(() => {
    rawCallCount = 0;
    rawResponses = [];
    mockRawRequest.mockClear();
    // Inject the mock client: countIssuesInState uses client.client.rawRequest()
    setClientForTesting({
      client: { rawRequest: mockRawRequest },
    } as unknown as LinearClient);
  });

  test("returns node count for a single-page result", async () => {
    rawResponses = [makeRawResponse(7, false, null)];
    const count = await countIssuesInState(TEST_IDS, "state-id");
    expect(count).toBe(7);
  });

  test("accumulates count across multiple pages", async () => {
    rawResponses = [
      makeRawResponse(5, true, "cursor-1"),
      makeRawResponse(3, false, null),
    ];
    const count = await countIssuesInState(TEST_IDS, "state-id");
    expect(count).toBe(8); // 5 + 3
  });

  test("retries rawRequest() on transient error and returns correct total", async () => {
    rawResponses = [
      makeRawResponse(3, true, "cursor-1"),
      Object.assign(new Error("service unavailable"), { status: 503 }),
      makeRawResponse(2, false, null),
    ];

    // Suppress retry warning output from withRetry
    const originalLog = console.log;
    console.log = () => {};
    const count = await countIssuesInState(TEST_IDS, "state-id");
    console.log = originalLog;

    expect(count).toBe(5); // 3 + 2
    expect(rawCallCount).toBe(3); // page1 + failed attempt + successful retry
  });

  test("stops pagination after MAX_PAGES and logs a warning", async () => {
    const warnMessages: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      if (typeof args[0] === "string") warnMessages.push(args[0]);
    };

    // MAX_PAGES = 100: provide 100 pages each with hasNextPage true
    rawResponses = Array.from({ length: 100 }, (_, i) =>
      makeRawResponse(1, true, `cursor-${i}`),
    );

    const count = await countIssuesInState(TEST_IDS, "state-id");
    console.log = originalLog;

    // MAX_PAGES is 100: initial page + 99 iterations = 100 pages × 1 node = 100
    expect(count).toBe(100);

    // A [WARN] message mentioning the page limit must have been logged
    const hasWarning = warnMessages.some(
      (msg) => msg.includes("[WARN]") && msg.includes("page limit"),
    );
    expect(hasWarning).toBe(true);
  });
});
