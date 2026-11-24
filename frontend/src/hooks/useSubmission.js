import { useCallback, useRef, useState } from "react";

export default function useSubmission() {
  const [state, setState] = useState({ status: "idle", error: "", success: "" });
  const retryRef = useRef(null);
  const runningRef = useRef(false);

  const run = useCallback(async (action, successMessage, afterSuccess) => {
    if (runningRef.current) return { ok: false, error: new Error("Envio em andamento.") };
    const execute = async () => {
      if (runningRef.current) return { ok: false, error: new Error("Envio em andamento.") };
      runningRef.current = true;
      setState({ status: "loading", error: "", success: "" });
      try {
        const result = await action();
        setState({ status: "success", error: "", success: successMessage });
        if (afterSuccess) afterSuccess(result);
        return { ok: true, result };
      } catch (error) {
        setState({ status: "error", error: error.message, success: "" });
        return { ok: false, error };
      } finally {
        runningRef.current = false;
      }
    };
    retryRef.current = execute;
    return execute();
  }, []);

  const retry = useCallback(() => retryRef.current?.(), []);
  const clear = useCallback(() => {
    if (!runningRef.current) setState({ status: "idle", error: "", success: "" });
  }, []);

  return { ...state, run, retry, clear };
}
