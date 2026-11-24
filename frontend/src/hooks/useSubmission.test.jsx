import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useSubmission from "./useSubmission.js";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

describe("useSubmission", () => {
  it("blocks a second submission while the first is running", async () => {
    const pending = deferred();
    const action = vi.fn(() => pending.promise);
    const { result } = renderHook(() => useSubmission());
    let first;
    let second;

    act(() => {
      first = result.current.run(action, "Saved");
      second = result.current.run(action, "Saved");
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("loading");
    act(() => result.current.clear());
    expect(result.current.status).toBe("loading");
    await act(async () => {
      pending.resolve("record");
      await first;
    });
    expect((await second).ok).toBe(false);
    expect(result.current.status).toBe("success");
  });

  it("retries the last validated action after an error", async () => {
    const action = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce("saved");
    const { result } = renderHook(() => useSubmission());

    await act(async () => { await result.current.run(action, "Saved"); });
    expect(result.current.status).toBe("error");
    await act(async () => { await result.current.retry(); });
    expect(action).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("success");
  });
});
