import { useEffect, useRef, type KeyboardEvent } from "react";
import { Icon } from "./Icon";

export interface Shot {
  src: string;
  /** Short label, e.g. "Step 3". */
  label: string;
  caption: string;
  /** Secondary detail such as the page URL. */
  detail?: string | null;
}

/**
 * Screenshot viewer on a native <dialog>: focus trapping, Escape to close and
 * focus return come from the browser. Arrow keys step through the run's shots.
 */
export function ScreenshotDialog(props: { shots: Shot[]; index: number | null; onChange: (index: number | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const shot = props.index === null ? undefined : props.shots[props.index];
  const open = shot !== undefined;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // React's autoFocus runs before the dialog opens, so focus Close explicitly.
      closeRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const index = props.index ?? 0;
  const hasPrev = index > 0;
  const hasNext = index < props.shots.length - 1;

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowLeft" && hasPrev) props.onChange(index - 1);
    if (e.key === "ArrowRight" && hasNext) props.onChange(index + 1);
  }

  return (
    <dialog
      ref={ref}
      className="viewer"
      aria-label={shot ? `${shot.label}: ${shot.caption}` : "Screenshot"}
      onClose={() => props.onChange(null)}
      onClick={(e) => e.target === ref.current && props.onChange(null)}
      onKeyDown={onKeyDown}
    >
      {shot && (
        <>
          <div className="viewer__bar">
            <div className="viewer__title">
              <span className="viewer__step mono">{shot.label}</span>
              <span className="viewer__caption">{shot.caption}</span>
            </div>
            <div className="btn-row">
              <span className="viewer__pos num muted small" aria-live="polite">
                {index + 1} / {props.shots.length}
              </span>
              <button type="button" className="btn btn--sm" disabled={!hasPrev} onClick={() => props.onChange(index - 1)} aria-label="Previous screenshot">
                <Icon name="chevron-left" size={14} />
              </button>
              <button type="button" className="btn btn--sm" disabled={!hasNext} onClick={() => props.onChange(index + 1)} aria-label="Next screenshot">
                <Icon name="chevron-right" size={14} />
              </button>
              <button type="button" className="btn btn--sm" onClick={() => props.onChange(null)} ref={closeRef}>
                Close
              </button>
            </div>
          </div>
          <div className="viewer__frame">
            <img src={shot.src} alt={`${shot.label}: ${shot.caption}`} />
          </div>
          {shot.detail && <p className="viewer__detail mono">{shot.detail}</p>}
        </>
      )}
    </dialog>
  );
}
