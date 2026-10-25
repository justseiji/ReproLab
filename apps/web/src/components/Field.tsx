import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** Props a field hands to its control so label, hint and error are announced together. */
export interface ControlProps {
  id: string;
  "aria-describedby": string;
  "aria-invalid": boolean;
}

/**
 * Label, hint, optional character counter and error message around one control.
 * The counter turns amber near the limit so it is noticed before it blocks typing.
 */
export function Field(props: {
  id: string;
  label: string;
  hint?: ReactNode;
  optional?: boolean;
  error?: string;
  count?: { value: number; max: number };
  children: (control: ControlProps) => ReactNode;
}) {
  const { id, count } = props;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const near = count ? count.value >= count.max * 0.9 : false;
  const describedBy = [props.hint || count ? hintId : null, props.error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {props.label} {props.optional && <span className="field__optional">(optional)</span>}
      </label>
      {(props.hint || count) && (
        <p id={hintId} className="field__hint">
          <span>{props.hint}</span>
          {count && (
            <span className={`field__counter${near ? " field__counter--near" : ""}`}>
              {count.value.toLocaleString()}/{count.max.toLocaleString()}
              <span className="sr-only"> characters</span>
            </span>
          )}
        </p>
      )}
      {props.children({ id, "aria-describedby": describedBy, "aria-invalid": Boolean(props.error) })}
      {props.error && (
        <p id={errorId} className="field__error">
          <Icon name="alert-circle" size={14} />
          <span>{props.error}</span>
        </p>
      )}
    </div>
  );
}
