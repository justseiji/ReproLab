import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** Native <details> for secondary information: keyboard and screen-reader support come from the browser. */
export function Disclosure(props: { summary: ReactNode; aside?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="disclosure" open={props.defaultOpen}>
      <summary>
        <Icon name="chevron-right" size={14} />
        {props.summary}
        {props.aside !== undefined && <span className="disclosure__aside">{props.aside}</span>}
      </summary>
      <div className="disclosure__body">{props.children}</div>
    </details>
  );
}
