import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiUsageNotice } from "@/components/ai-usage";

const historyRequests: string[] = [];
const usage = {
  plan: "monthly",
  drafting: { limit: 30, used: 4, remaining: 26 },
  transcription: { limit: 30, used: 2, remaining: 28 },
  resetsAt: "2026-11-25T00:00:00.000Z",
};
const history = {
  days: 30,
  retentionDays: 90,
  entries: [
    {
      day: "2026-11-24",
      plans: ["monthly"],
      planHistoryComplete: true,
      draftingRequests: 2,
      transcriptionRequests: 1,
    },
    {
      day: "2026-11-23",
      plans: [],
      planHistoryComplete: false,
      draftingRequests: 3,
      transcriptionRequests: 0,
    },
  ],
};
let client: QueryClient;

afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
  historyRequests.length = 0;
});

it("opens private daily counts and clearly marks plans missing from older records", async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = input instanceof Request ? input.url : String(input);
    if (path.includes("/api/writing/usage-history")) {
      historyRequests.push(path);
      return Response.json(history);
    }
    if (path.includes("/api/writing/usage")) return Response.json(usage);
    throw new Error(`Unexpected request: ${path}`);
  });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><AiUsageNotice /></QueryClientProvider>);

  expect(await screen.findByText(/Your daily AI allowance/)).toBeTruthy();
  expect(historyRequests).toHaveLength(0);
  await user.click(screen.getByTestId("button-ai-history"));

  expect(await screen.findByText("Last 30 days")).toBeTruthy();
  const rows = await screen.findAllByTestId("row-ai-usage-history");
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain("Monthly");
  expect(rows[0]?.textContent).toContain("2");
  expect(rows[0]?.textContent).toContain("1");
  expect(rows[1]?.textContent).toContain("Not recorded");
  expect(await screen.findByText(/Older requests were counted before plan snapshots/)).toBeTruthy();
  expect(await screen.findByText(/no prompts, transcripts, or case details/i)).toBeTruthy();
  await waitFor(() => expect(historyRequests.some((path) => path.includes("days=30"))).toBe(true));
});
