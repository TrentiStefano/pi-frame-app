import { useEffect, useRef, type RefObject } from "react";

const MAX_BOUNCE_PX = 56;
const DAMPING = 0.32;
const SPRING_DECAY = 0.84;
const GRACE_PERIOD_MS = 50;

/**
 * Provides immediate rubber-band spring scrolling for conversation timeline
 * containers on platforms without native overscroll bounce (like Windows Electron).
 *
 * Uses direct hardware-accelerated transform updates and an active spring loop
 * with a short grace period during continuous wheel input to prevent inter-notch jitter.
 */
export function useElasticScroll(
  paneRef: RefObject<HTMLDivElement | null>,
  wrapperRef: RefObject<HTMLDivElement | null>,
  options?: { readonly disabled?: boolean },
): void {
  const disabled = options?.disabled ?? false;
  const offsetRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const lastInputTimeRef = useRef(0);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || disabled) {
      if (wrapperRef.current) {
        wrapperRef.current.style.transform = "";
        wrapperRef.current.style.willChange = "";
      }
      offsetRef.current = 0;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      return undefined;
    }

    const cancelSpring = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (wrapperRef.current) {
        wrapperRef.current.style.transform = "";
        wrapperRef.current.style.willChange = "";
      }
      offsetRef.current = 0;
    };

    const stepSpring = () => {
      const now = performance.now();
      // Short grace period: do not decay while the user is actively wheeling in between notches
      if (now - lastInputTimeRef.current < GRACE_PERIOD_MS) {
        rafIdRef.current = requestAnimationFrame(stepSpring);
        return;
      }

      let current = offsetRef.current;
      if (Math.abs(current) < 0.5) {
        offsetRef.current = 0;
        if (wrapperRef.current) {
          wrapperRef.current.style.transform = "";
          wrapperRef.current.style.willChange = "";
        }
        rafIdRef.current = null;
        return;
      }

      // Continuous active spring decay - pulls immediately back like a rubber band
      current *= SPRING_DECAY;
      offsetRef.current = current;

      if (wrapperRef.current) {
        wrapperRef.current.style.transform = `translate3d(0, ${current.toFixed(2)}px, 0)`;
      }

      rafIdRef.current = requestAnimationFrame(stepSpring);
    };

    const startSpring = () => {
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(stepSpring);
      }
    };

    const applyOffset = (delta: number) => {
      lastInputTimeRef.current = performance.now();
      const current = offsetRef.current;
      const resistance = Math.max(0.12, 1 - Math.abs(current) / MAX_BOUNCE_PX);
      const next = current + delta * DAMPING * resistance;
      const clamped = Math.max(-MAX_BOUNCE_PX, Math.min(MAX_BOUNCE_PX, next));
      offsetRef.current = clamped;

      if (wrapperRef.current) {
        wrapperRef.current.style.transform = clamped === 0 ? "" : `translate3d(0, ${clamped.toFixed(2)}px, 0)`;
        wrapperRef.current.style.willChange = clamped === 0 ? "" : "transform";
      }
      startSpring();
    };

    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < Math.abs(event.deltaX) || event.deltaY === 0) {
        return;
      }

      const current = offsetRef.current;

      // At top boundary scrolling up (deltaY < 0 -> stretch down, positive offset)
      if (event.deltaY < 0) {
        if (pane.scrollTop <= 1) {
          event.preventDefault();
          applyOffset(-event.deltaY);
          return;
        }
      } else if (event.deltaY > 0) {
        // At bottom boundary scrolling down (deltaY > 0 -> stretch up, negative offset)
        const remaining = pane.scrollHeight - pane.clientHeight - pane.scrollTop;
        if (remaining <= 1) {
          event.preventDefault();
          applyOffset(-event.deltaY);
          return;
        }
      }

      // Already stretched: absorb wheel impulse into rubber band
      if (current !== 0) {
        event.preventDefault();
        applyOffset(-event.deltaY);
      }
    };

    let touchStartY = 0;
    let isTouching = false;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 1) {
        const touch = event.touches[0];
        if (touch) {
          touchStartY = touch.clientY;
          isTouching = true;
        }
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!isTouching || event.touches.length !== 1) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const touchY = touch.clientY;
      const deltaY = touchY - touchStartY;
      touchStartY = touchY;

      const current = offsetRef.current;
      if (deltaY > 0 && pane.scrollTop <= 1) {
        applyOffset(deltaY);
      } else if (deltaY < 0 && (pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 1)) {
        applyOffset(deltaY);
      } else if (current !== 0) {
        applyOffset(deltaY);
      }
    };

    const handleTouchEnd = () => {
      if (isTouching) {
        isTouching = false;
        startSpring();
      }
    };

    pane.addEventListener("wheel", handleWheel, { passive: false });
    pane.addEventListener("touchstart", handleTouchStart, { passive: true });
    pane.addEventListener("touchmove", handleTouchMove, { passive: true });
    pane.addEventListener("touchend", handleTouchEnd, { passive: true });
    pane.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      cancelSpring();
      pane.removeEventListener("wheel", handleWheel);
      pane.removeEventListener("touchstart", handleTouchStart);
      pane.removeEventListener("touchmove", handleTouchMove);
      pane.removeEventListener("touchend", handleTouchEnd);
      pane.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [disabled, paneRef, wrapperRef]);
}
