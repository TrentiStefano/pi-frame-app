import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";

interface SidePanelResizerProps {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}

export function SidePanelResizer({ value, min, max, onChange }: SidePanelResizerProps) {
  const { t } = useTranslation();
  const startRef = useRef<{ readonly x: number; readonly width: number } | null>(null);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    startRef.current = null;
  };

  return (
    <div
      aria-label={t("common.resize", { defaultValue: "Resize panel" })}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className="side-panel-resizer"
      role="separator"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onChange(clamp(value + 16));
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onChange(clamp(value - 16));
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        startRef.current = { x: event.clientX, width: value };
      }}
      onPointerMove={(event) => {
        const start = startRef.current;
        if (start) {
          onChange(clamp(start.width - (event.clientX - start.x)));
        }
      }}
      onPointerCancel={stopDragging}
      onPointerUp={stopDragging}
    />
  );
}
