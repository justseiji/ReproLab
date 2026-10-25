import type { ReactNode } from "react";
import { useIncremental } from "../hooks";

export interface Column<T> {
  key: string;
  /** Header text; also the inline label when rows stack on narrow screens. */
  header: string;
  cell: (row: T) => ReactNode;
  align?: "start" | "end";
  /** Shrink to content width. */
  shrink?: boolean;
  /** The row's identifying cell: rendered as a row header and given full width when stacked. */
  primary?: boolean;
  /** Full width when stacked (e.g. long summaries). */
  wide?: boolean;
  /** Takes two of the three stacked columns (e.g. status labels that need room). */
  emphasis?: boolean;
}

/**
 * Data-driven table. Renders `pageSize` rows at a time with a "Show more"
 * control, so long histories stay fast and the same API can later be backed
 * by server pagination. Rows stack into labelled blocks on narrow screens.
 */
export function DataTable<T>(props: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  pageSize?: number;
  noun?: string;
}) {
  const { visible, remaining, showMore } = useIncremental(props.rows, props.pageSize ?? 50);
  const noun = props.noun ?? "rows";

  return (
    <div className="table-wrap">
      <table className="table table--stack">
        <caption className="sr-only">{props.caption}</caption>
        <thead>
          <tr>
            {props.columns.map((c) => (
              <th key={c.key} scope="col" className={cellClass(c)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={props.rowKey(row)}>
              {props.columns.map((c) =>
                c.primary ? (
                  <th key={c.key} scope="row" className={cellClass(c)}>
                    {c.cell(row)}
                  </th>
                ) : (
                  <td key={c.key} className={cellClass(c)} data-label={c.header}>
                    {c.cell(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {remaining > 0 && (
        <div className="table__footer">
          <span className="num">
            Showing {visible.length} of {props.rows.length} {noun}
          </span>
          <button type="button" className="btn btn--sm" onClick={showMore}>
            Show {Math.min(remaining, props.pageSize ?? 50)} more
          </button>
        </div>
      )}
    </div>
  );
}

function cellClass<T>(c: Column<T>): string {
  return [c.align === "end" && "cell--end", c.shrink && "cell--shrink", c.primary && "cell--primary", c.wide && "cell--wide", c.emphasis && "cell--emphasis"]
    .filter(Boolean)
    .join(" ");
}
