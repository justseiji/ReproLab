import type { ReactNode } from "react";
import { Link } from "react-router";

export interface Crumb {
  label: string;
  to?: string;
}

/** Title block at the top of every page: breadcrumbs, title, description or metadata, and primary actions. */
export function PageHeader(props: { title: ReactNode; crumbs?: Crumb[]; description?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      {props.crumbs && (
        <nav aria-label="Breadcrumb" className="page-header__crumbs">
          <ol>
            {props.crumbs.map((c, i) => (
              <li key={i}>{c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
            ))}
          </ol>
        </nav>
      )}
      <div className="page-header__text">
        <h1 className="page-header__title">{props.title}</h1>
        {props.description && <p className="page-header__desc">{props.description}</p>}
        {props.meta}
      </div>
      {props.actions && <div className="page-header__actions">{props.actions}</div>}
    </header>
  );
}
