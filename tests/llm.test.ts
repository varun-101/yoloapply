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

describe("chatJson response shape", () => {
  beforeEach(() => {
    mocks.create.mockReset();
  });

  // A gateway answering 200 with an error-shaped body (no `choices` at all)
  // used to throw "Cannot read properties of undefined (reading '0')" from
  // outside the retry loop's catch, killing the caller. A discovery scan died
  // that way.
  it("retries instead of crashing when the provider returns no choices array", async () => {
    mocks.create
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(response('{"ok":true}', "stop", 12));

    await expect(
      chatJson<{ ok: boolean }>({ apiKey: "no-choices-key", system: "system", user: "user" })
    ).resolves.toEqual({ ok: true });

    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("reports an empty choices array as unusable output rather than throwing a TypeError", async () => {
    mocks.create.mockResolvedValue({ choices: [] });

    await expect(
      chatJson({ apiKey: "empty-choices-key", system: "system", user: "user" })
    ).rejects.toThrow("provider returned no usable JSON");
  });
});

// Coverage for the provider-error retry path in chatJson (isRetryableProviderError
// + waitBeforeProviderRetry). Reconstructed, so it may not match the original
// cases one for one.
describe("chatJson provider errors", () => {
  beforeEach(() => {
    mocks.create.mockReset();
  });

  function apiError(status: number): Error & { status: number } {
    return Object.assign(new Error(`HTTP ${status}`), { status });
  }

  it("retries a 5xx and succeeds on a later attempt", async () => {
    mocks.create
      .mockRejectedValueOnce(apiError(502))
      .mockResolvedValueOnce(response('{"ok":true}', "stop", 12));

    await expect(
      chatJson<{ ok: boolean }>({ apiKey: "retry-5xx-key", system: "system", user: "user" })
    ).resolves.toEqual({ ok: true });

    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("retries a rate limit", async () => {
    mocks.create
      .mockRejectedValueOnce(apiError(429))
      .mockResolvedValueOnce(response('{"ok":true}', "stop", 12));

    await expect(
      chatJson<{ ok: boolean }>({ apiKey: "retry-429-key", system: "system", user: "user" })
    ).resolves.toEqual({ ok: true });

    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  // An invalid key fails the same way on every attempt; burning the retry
  // budget on it only delays telling the user to fix their key.
  it("does not retry an auth failure", async () => {
    mocks.create.mockRejectedValue(apiError(401));

    await expect(
      chatJson({ apiKey: "bad-key", system: "system", user: "user" })
    ).rejects.toThrow("HTTP 401");

    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  // A gateway returning a plain-text 5xx body under a JSON content type: the
  // SDK surfaces a SyntaxError, which is just as transient as the 502 it hides.
  it("retries a non-JSON body surfaced as a SyntaxError", async () => {
    mocks.create
      .mockRejectedValueOnce(new SyntaxError('"upstream error" is not valid JSON'))
      .mockResolvedValueOnce(response('{"ok":true}', "stop", 12));

    await expect(
      chatJson<{ ok: boolean }>({ apiKey: "retry-syntax-key", system: "system", user: "user" })
    ).resolves.toEqual({ ok: true });

    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("gives up with a provider-failure message once the retries are spent", async () => {
    mocks.create.mockRejectedValue(apiError(503));

    await expect(
      chatJson({ apiKey: "dead-provider-key", system: "system", user: "user" })
    ).rejects.toThrow("LLM provider failed after 3 attempts");

    expect(mocks.create).toHaveBeenCalledTimes(3);
  });
});
