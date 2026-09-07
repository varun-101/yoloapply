import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mocks.create } };
  },
}));

import { chatJson } from "@/lib/llm";

function response(content: string | null, finishReason: string, completionTokens: number) {
  return {
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { completion_tokens: completionTokens },
  };
}

describe("chatJson", () => {
  beforeEach(() => {
    mocks.create.mockReset();
  });

  it("increases the output budget after a length-limited empty response", async () => {
    mocks.create
      .mockResolvedValueOnce(response("", "length", 8192))
      .mockResolvedValueOnce(response('{"ok":true}', "stop", 12));

    await expect(
      chatJson<{ ok: boolean }>({ apiKey: "length-retry-key", system: "system", user: "user" })
    ).resolves.toEqual({ ok: true });

    expect(mocks.create.mock.calls.map(([request]) => request.max_tokens)).toEqual([8192, 16384]);
  });

  it("increases the output budget when a length-limited response contains partial JSON", async () => {
    mocks.create
      .mockResolvedValueOnce(response('{"ok":', "length", 8192))
      .mockResolvedValueOnce(response('{"ok":true}', "stop", 12));

    await expect(
      chatJson<{ ok: boolean }>({ apiKey: "partial-retry-key", system: "system", user: "user" })
    ).resolves.toEqual({ ok: true });

    expect(mocks.create.mock.calls.map(([request]) => request.max_tokens)).toEqual([8192, 16384]);
  });

  it("does not raise the budget for ordinary empty responses", async () => {
    mocks.create.mockResolvedValue(response("", "stop", 0));

    await expect(
      chatJson({ apiKey: "empty-retry-key", system: "system", user: "user", maxTokens: 500 })
    ).rejects.toThrow("provider returned no usable JSON");

    expect(mocks.create.mock.calls.map(([request]) => request.max_tokens)).toEqual([500, 500, 500]);
  });

  it("reports persistent truncation accurately", async () => {
    mocks.create.mockResolvedValue(response("", "length", 32768));

    await expect(
      chatJson({ apiKey: "truncated-key", system: "system", user: "user" })
    ).rejects.toThrow("response was truncated before it produced JSON");

    expect(mocks.create.mock.calls.map(([request]) => request.max_tokens)).toEqual([
      8192,
      16384,
      32768,
    ]);
  });
});
