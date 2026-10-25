import { useState } from "react";
import { Icon } from "./Icon";

export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code">
      <div className="code__bar">
        <span className="code__file" title={label}>
          {label}
        </span>
        <button type="button" className="btn btn--quiet btn--sm" onClick={copy}>
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? "Code copied to clipboard" : ""}
        </span>
      </div>
      <pre className="code__pre" tabIndex={0} aria-label={label}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
