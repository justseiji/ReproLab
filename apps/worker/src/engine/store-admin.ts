import type { BugFlags } from "@reprolab/shared";
import { InfraError } from "../errors";

/**
 * Talks to the demo store from the worker process (never from the agent's
 * browser). Used to check reachability, to record the bug switches as
 * evidence, and by the evaluation commands to flip bugs.
 */

export async function checkStoreReachable(storeUrl: string): Promise<void> {
  try {
    const res = await fetch(new URL("/api/health", storeUrl), { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InfraError("STORE_UNAVAILABLE", `The demo store at ${storeUrl} is not reachable (${detail}).`, true);
  }
}

export async function getStoreBugs(adminUrl: string): Promise<BugFlags> {
  const res = await fetch(new URL("/admin/bugs", adminUrl), { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`Store admin returned HTTP ${res.status}`);
  return ((await res.json()) as { bugs: BugFlags }).bugs;
}

export async function setStoreBugs(adminUrl: string, update: Partial<BugFlags>): Promise<BugFlags> {
  const res = await fetch(new URL("/admin/bugs", adminUrl), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Store admin returned HTTP ${res.status}`);
  return ((await res.json()) as { bugs: BugFlags }).bugs;
}
