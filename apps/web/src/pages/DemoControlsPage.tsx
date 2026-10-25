import { useState } from "react";
import { BUG_INFO, BUG_KEYS, type BugKey } from "@reprolab/shared";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { ErrorState, Loading } from "../components/states";
import { useAppConfig } from "../config-context";
import { useResource } from "../hooks";

export function DemoControlsPage() {
  const { config } = useAppConfig();
  const bugs = useResource(api.storeBugs, []);
  const [saving, setSaving] = useState<BugKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setBug(key: BugKey, enabled: boolean) {
    setSaving(key);
    setError(null);
    try {
      await api.setStoreBugs({ [key]: enabled });
      bugs.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  const enabledCount = bugs.data ? BUG_KEYS.filter((k) => bugs.data!.bugs[k]).length : 0;

  return (
    <>
      <PageHeader
        title="Demo controls"
        description="Switch each deliberate store bug between enabled and fixed, then re-run a report to see the outcome and exported test change."
        actions={
          config && (
            <a className="btn" href={config.storeUrl} target="_blank" rel="noreferrer">
              Open the demo store
              <Icon name="arrow-up-right" size={14} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )
        }
      />

      {error && (
        <Notice tone="error" alert title="Could not change the switch">
          {error}
        </Notice>
      )}

      <Section
        id="bugs"
        title="Store bugs"
        description={
          bugs.data ? (
            <>
              <strong className="num">
                {enabledCount} of {BUG_KEYS.length}
              </strong>{" "}
              enabled. Runs started now see the store in this state; each run records the state it started with.
            </>
          ) : undefined
        }
      >
        {bugs.loading && !bugs.data ? (
          <Loading label="Reading store configuration…" />
        ) : bugs.error && !bugs.data ? (
          <ErrorState title="Could not read the store configuration" error={bugs.error} onRetry={bugs.reload} />
        ) : (
          <ul className="bug-list panel panel--flush">
            {BUG_KEYS.map((key) => {
              const enabled = bugs.data!.bugs[key];
              const info = BUG_INFO[key];
              const id = `bug-${key}`;
              return (
                <li key={key} className={`bug tone-${enabled ? "bad" : "ok"}`} aria-busy={saving === key}>
                  <div className="bug__text">
                    <h3 id={`${id}-title`} className="bug__title">
                      {info.title}
                    </h3>
                    <p className="bug__now">
                      <span className="status">
                        <Icon name={enabled ? "alert-circle" : "check-circle"} size={14} />
                        {enabled ? "Bug enabled" : "Fixed"}
                      </span>
                      <span>{enabled ? info.broken : info.fixed}</span>
                    </p>
                    <p className="bug__other small muted">
                      {enabled ? "When fixed: " : "When enabled: "}
                      {enabled ? info.fixed : info.broken}
                    </p>
                  </div>
                  <fieldset className="segmented" disabled={saving !== null} aria-labelledby={`${id}-title`}>
                    <label className="segmented__option segmented__option--bad">
                      <input type="radio" name={id} checked={enabled} onChange={() => setBug(key, true)} />
                      <span>Bug enabled</span>
                    </label>
                    <label className="segmented__option segmented__option--ok">
                      <input type="radio" name={id} checked={!enabled} onChange={() => setBug(key, false)} />
                      <span>Fixed</span>
                    </label>
                  </fieldset>
                  {saving === key && (
                    <span className="bug__saving small muted" role="status">
                      <Icon name="spinner" size={14} spin /> Saving…
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Notice title="Demo only">
        The switches live on the store's localhost admin port and are proxied by this API. The agent's browser is restricted to the
        storefront origin, so a run can never flip them. Changes apply to page loads after the switch.
      </Notice>
    </>
  );
}
