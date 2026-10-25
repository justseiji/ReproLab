import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { CreateReportRequestSchema, LIMITS, SEEDED_REPORTS, type RunMode } from "@reprolab/shared";
import { api, ApiRequestError } from "../api";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { useAppConfig } from "../config-context";

type FieldName = "title" | "description" | "expectedBehavior" | "actualBehavior";
type Values = Record<FieldName, string>;
type Errors = Partial<Record<FieldName, string>>;

interface FieldSpec {
  name: FieldName;
  label: string;
  hint: string;
  rows?: number;
  max: number;
  required: boolean;
  placeholder?: string;
}

/** Fields are grouped the way a reproduction is read: what to do, then what should happen. */
const GROUPS: Array<{ id: string; title: string; fields: FieldSpec[] }> = [
  {
    id: "problem",
    title: "The problem",
    fields: [
      { name: "title", label: "Title", hint: "One line that names the problem.", max: LIMITS.title.max, required: true },
      {
        name: "description",
        label: "Steps or description",
        hint: "What to do in the store. Numbered steps work best.",
        rows: 6,
        max: LIMITS.description.max,
        required: true,
        placeholder: "1. Add the Canvas Tote to the cart.\n2. Open the cart.\n3. …",
      },
    ],
  },
  {
    id: "expectation",
    title: "The expectation",
    fields: [
      {
        name: "expectedBehavior",
        label: "Expected behavior",
        hint: "What should happen. Be specific — this becomes the assertion.",
        rows: 3,
        max: LIMITS.expectedBehavior.max,
        required: true,
      },
      { name: "actualBehavior", label: "Actual behavior", hint: "What happens instead.", rows: 3, max: LIMITS.actualBehavior.max, required: false },
    ],
  },
];

const FIELD_ORDER: FieldName[] = GROUPS.flatMap((g) => g.fields.map((f) => f.name));
const EMPTY: Values = { title: "", description: "", expectedBehavior: "", actualBehavior: "" };

function buildBody(values: Values, mode: RunMode) {
  return { report: { ...values, actualBehavior: values.actualBehavior || undefined }, mode };
}

/** Runs the shared schema (same one the API uses) and returns the first message per field. */
function validate(values: Values, mode: RunMode): Errors {
  const parsed = CreateReportRequestSchema.safeParse(buildBody(values, mode));
  if (parsed.success) return {};
  const errors: Errors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[1] as FieldName | undefined;
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

export function NewReportPage() {
  const { config } = useAppConfig();
  const navigate = useNavigate();
  const liveAvailable = Boolean(config?.liveAi.available);
  const [values, setValues] = useState<Values>(EMPTY);
  const [mode, setMode] = useState<RunMode>("SCRIPTED");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [focusSummary, setFocusSummary] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);

  // Default to live AI when it is configured.
  useEffect(() => {
    if (liveAvailable) setMode("LIVE_AI");
  }, [liveAvailable]);

  // Move focus to the error summary after a failed submit (not while typing).
  useEffect(() => {
    if (focusSummary > 0) summaryRef.current?.focus();
  }, [focusSummary]);

  const fieldErrors = FIELD_ORDER.filter((f) => errors[f]);
  const showSummary = submitted && (fieldErrors.length > 0 || formError !== null);

  function update(name: FieldName, value: string) {
    const next = { ...values, [name]: value };
    setValues(next);
    // After the first submit attempt, keep errors in sync as the user fixes them.
    if (submitted) setErrors(validate(next, mode));
    else if (errors[name]) setErrors(({ [name]: _removed, ...rest }) => rest);
  }

  // Check a field when the user leaves it, but don't flag fields that were simply tabbed past.
  function blur(name: FieldName) {
    if (submitted || values[name].trim() === "") return;
    const message = validate(values, mode)[name];
    setErrors(({ [name]: _removed, ...rest }) => (message ? { ...rest, [name]: message } : rest));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setFormError(null);
    const found = validate(values, mode);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFocusSummary((n) => n + 1);
      return;
    }
    setSubmitting(true);
    try {
      const { run } = await api.createReport(buildBody(values, mode));
      navigate(`/runs/${run.id}`);
    } catch (e) {
      setSubmitting(false);
      if (e instanceof ApiRequestError && e.details?.length) {
        const serverErrors: Errors = {};
        for (const d of e.details) {
          const field = d.path.split(".")[1] as FieldName | undefined;
          if (field) serverErrors[field] = d.message;
        }
        setErrors(serverErrors);
        if (Object.keys(serverErrors).length === 0) setFormError(e.message);
      } else {
        setFormError(e instanceof Error ? e.message : String(e));
      }
      setFocusSummary((n) => n + 1);
    }
  }

  function fillExample(r: (typeof SEEDED_REPORTS)[number]) {
    setValues({ title: r.title, description: r.description, expectedBehavior: r.expectedBehavior, actualBehavior: r.actualBehavior ?? "" });
    setErrors({});
    setFormError(null);
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: "/" }, { label: "New report" }]}
        title="New bug report"
        description="Describe a bug in the included demo store. ReproLab will try to reproduce it in an isolated browser."
      />

      <div className="form-layout">
        <form className="form" onSubmit={submit} noValidate aria-describedby={showSummary ? "error-summary" : undefined}>
          {showSummary && (
            <Notice id="error-summary" tone="error" alert focusRef={summaryRef} title="Please fix the following before submitting:">
              <ul>
                {formError && <li>{formError}</li>}
                {fieldErrors.map((field) => (
                  <li key={field}>
                    <a href={`#field-${field}`}>{errors[field]}</a>
                  </li>
                ))}
              </ul>
            </Notice>
          )}

          {GROUPS.map((group, i) => (
            <fieldset key={group.id} className="form-group">
              <legend className="form-group__legend">
                <span className="form-group__index mono">{i + 1}</span>
                {group.title}
              </legend>
              {group.fields.map((f) => (
                <Field
                  key={f.name}
                  id={`field-${f.name}`}
                  label={f.label}
                  hint={f.hint}
                  optional={!f.required}
                  error={errors[f.name]}
                  count={{ value: values[f.name].length, max: f.max }}
                >
                  {(control) => {
                    const common = {
                      ...control,
                      name: f.name,
                      className: "input",
                      value: values[f.name],
                      maxLength: f.max,
                      required: f.required,
                      placeholder: f.placeholder,
                      onBlur: () => blur(f.name),
                    };
                    return f.rows ? (
                      <textarea rows={f.rows} {...common} onChange={(e) => update(f.name, e.target.value)} />
                    ) : (
                      <input type="text" {...common} onChange={(e) => update(f.name, e.target.value)} />
                    );
                  }}
                </Field>
              ))}
            </fieldset>
          ))}

          <fieldset className="form-group">
            <legend className="form-group__legend">
              <span className="form-group__index mono">{GROUPS.length + 1}</span>
              Reproduction mode
            </legend>
            <div className="choices">
              <label className="choice">
                <input
                  type="radio"
                  name="mode"
                  value="LIVE_AI"
                  checked={mode === "LIVE_AI"}
                  disabled={!liveAvailable}
                  onChange={() => setMode("LIVE_AI")}
                  aria-describedby="mode-live-desc"
                />
                <span className="choice__title">
                  Live AI {!liveAvailable && <span className="tag">unavailable</span>}
                </span>
                <span id="mode-live-desc" className="choice__desc">
                  {liveAvailable
                    ? `${config?.liveAi.providerLabel} (${config?.liveAi.model}) plans validated browser actions from the page's elements.`
                    : (config?.liveAi.reason ?? "Not available.")}
                </span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="mode"
                  value="SCRIPTED"
                  checked={mode === "SCRIPTED"}
                  onChange={() => setMode("SCRIPTED")}
                  aria-describedby="mode-scripted-desc"
                />
                <span className="choice__title">Scripted demo</span>
                <span id="mode-scripted-desc" className="choice__desc">
                  Recipes exist only for the three seeded reports. Other reports end Inconclusive and explain that live AI is
                  required — nothing is guessed.
                </span>
              </label>
            </div>
          </fieldset>

          <div className="form-actions btn-row">
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? (
                <>
                  <Icon name="spinner" size={14} spin />
                  Submitting…
                </>
              ) : (
                "Submit and start run"
              )}
            </button>
            <Link to="/" className="btn btn--quiet">
              Cancel
            </Link>
          </div>
        </form>

        <aside className="form-aside" aria-labelledby="examples-aside-heading">
          <h2 id="examples-aside-heading" className="label">
            Start from an example
          </h2>
          <p className="small muted">Copies a seeded report into the form, e.g. to try it with live AI.</p>
          <ul className="example-picks">
            {SEEDED_REPORTS.map((r) => (
              <li key={r.seedKey}>
                <button type="button" className="btn btn--block btn--sm" onClick={() => fillExample(r)}>
                  {r.title}
                </button>
              </li>
            ))}
          </ul>
          <h2 className="label">Writing a reproducible report</h2>
          <ul className="tips small muted">
            <li>Name the products and coupon codes you used.</li>
            <li>State the expected numbers or visible result.</li>
            <li>Vague expectations ("should work") return Inconclusive with a clarification question.</li>
          </ul>
        </aside>
      </div>
    </>
  );
}
