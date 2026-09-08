import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";

interface SidebarResizerProps {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  readonly onResizeStart?: () => void;
  readonly onResizeEnd?: () => void;
}

export function SidebarResizer({ value, min, max, onChange, onResizeStart, onResizeEnd }: SidebarResizerProps) {
  const { t } = useTranslation();
  const startRef = useRef<{ readonly x: number; readonly width: number } | null>(null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = { x: event.clientX, width: value };
    onResizeStart?.();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start) return;
    onChange(Math.min(max, Math.max(min, start.width + event.clientX - start.x)));
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    startRef.current = null;
    onResizeEnd?.();
  };

  return (
    <div
      aria-label={t("sidebar.resize")}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className="sidebar-resizer"
      role="separator"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onChange(Math.max(min, value - 16));
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onChange(Math.min(max, value + 16));
        }
      }}
      onPointerCancel={stopDragging}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
    />
  );
}
