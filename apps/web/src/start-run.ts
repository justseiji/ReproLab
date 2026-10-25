import { useState } from "react";
import { useNavigate } from "react-router";
import type { RunMode } from "@reprolab/shared";
import { api } from "./api";

/** Queues a run for an existing report and opens its run page. */
export function useStartRun() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(reportId: string, mode: RunMode) {
    setPending(`${reportId}:${mode}`);
    setError(null);
    try {
      const run = await api.createRun(reportId, mode);
      navigate(`/runs/${run.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending(null);
    }
  }

  return { start, pending, error };
}
