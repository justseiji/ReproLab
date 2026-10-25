import type { ReactNode, Ref } from "react";
import { Icon, type IconName } from "./Icon";

type NoticeTone = "info" | "warn" | "error";

const TONE: Record<NoticeTone, { className: string; icon: IconName }> = {
  info: { className: "", icon: "info-circle" },
  warn: { className: "tone-warn", icon: "alert" },
  error: { className: "tone-bad", icon: "alert-circle" },
};

/** Inline message. `role="alert"` is used for errors the user just caused; otherwise it is a note. */
export function Notice(props: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  alert?: boolean;
  id?: string;
  focusRef?: Ref<HTMLDivElement>;
}) {
  const tone = TONE[props.tone ?? "info"];
  return (
    <div
      id={props.id}
      ref={props.focusRef}
      tabIndex={props.focusRef ? -1 : undefined}
      className={`notice ${tone.className}`}
      role={props.alert ? "alert" : "note"}
    >
      <Icon name={tone.icon} />
      <div className="notice__body">
        {props.title && <p className="notice__title">{props.title}</p>}
        {props.children}
      </div>
    </div>
  );
}
