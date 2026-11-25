import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("api request cancellation", () => {
  it("propagates caller cancellation without reporting a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const caller = new AbortController();
    const pending = api("/api/products", "access-token", { signal: caller.signal });

    caller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports the request timeout with a user-friendly message", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const pending = api("/api/products", "access-token");
    const assertion = expect(pending).rejects.toThrow("A solicitação excedeu o tempo limite");

    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });

  it("uses a friendly connection error for fetch failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(api("/api/users", "access-token"))
      .rejects.toThrow("Não foi possível conectar ao servidor");
  });
});
