import type { ReactNode } from "react";

/**
 * A titled region of a page. Plain by default (spacing and a heading organize
 * it); pass `surface` only when the content needs a bordered container.
 */
export function Section(props: {
  id: string;
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  actions?: ReactNode;
  surface?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const headingId = `${props.id}-heading`;
  const classes = ["section", props.surface && "panel", props.className].filter(Boolean).join(" ");
  return (
    <section className={classes} aria-labelledby={headingId}>
      <div className="section__header">
        <div className="section__heading">
          <h2 id={headingId} className="section__title">
            {props.title}
            {props.count !== undefined && <span className="section__count num">{props.count}</span>}
          </h2>
          {props.description && <p className="section__desc">{props.description}</p>}
        </div>
        {props.actions && <div className="section__actions">{props.actions}</div>}
      </div>
      {props.children}
    </section>
  );
}
