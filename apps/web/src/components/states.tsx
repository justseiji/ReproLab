import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Loading({ label = "Loading…", compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div className={`state${compact ? " state--compact" : ""}`} role="status">
      <span className="state__icon tone-accent">
        <Icon name="spinner" size={20} spin />
      </span>
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, title = "Something went wrong", onRetry }: { error: Error; title?: string; onRetry?: () => void }) {
  return (
    <div className="state state--error tone-bad" role="alert">
      <span className="state__icon">
        <Icon name="alert-circle" size={22} />
      </span>
      <p className="state__title">{title}</p>
      <p className="state__body">{error.message}</p>
      {onRetry && (
        <button type="button" className="btn btn--sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState(props: { title: string; icon?: IconName; compact?: boolean; children?: ReactNode }) {
  return (
    <div className={`state${props.compact ? " state--compact" : ""}`}>
      {props.icon && (
        <span className="state__icon">
          <Icon name={props.icon} size={20} />
        </span>
      )}
      <p className="state__title">{props.title}</p>
      {props.children && <div className="state__body">{props.children}</div>}
    </div>
  );
}
