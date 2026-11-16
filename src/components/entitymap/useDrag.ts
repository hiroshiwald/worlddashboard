"use client";

import { useRef, type PointerEvent } from "react";
import type { Offset } from "@/hooks/useEntityMap";

const DRAG_THRESHOLD_PX = 4;

/** Drag for SVG elements marked data-drag="key". `suppress.current` is true right after a drag ends, so the click that follows can be ignored. */
export function useDrag(offsets: Record<string, Offset>, moveBy: (key: string, o: Offset) => void) {
  const svgRef = useRef<SVGSVGElement>(null);
  const suppress = useRef(false);

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const el = (e.target as Element).closest("[data-drag]");
    const svg = svgRef.current;
    if (el === null || svg === null || e.button !== 0) return;
    const key = el.getAttribute("data-drag") as string;
    const start = offsets[key] ?? { dx: 0, dy: 0 };
    // preserveAspectRatio "meet": the drawing scales by the tighter of the two axes.
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / svg.viewBox.baseVal.width, rect.height / svg.viewBox.baseVal.height);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const move = (ev: globalThis.PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      moved = true;
      moveBy(key, { dx: start.dx + dx / scale, dy: start.dy + dy / scale });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!moved) return;
      suppress.current = true;
      // Detached on purpose: the click event fires right after pointerup; clear the flag once it has passed.
      setTimeout(() => {
        suppress.current = false;
      }, 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return { svgRef, suppress, onPointerDown };
}
