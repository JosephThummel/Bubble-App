import { useEffect } from "react";

// The last thing focused outside any overlay. Captured on focus rather than when an
// overlay opens, because by then its own autofocused input already has focus.
let lastOutside: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", e => {
    const t = e.target;
    if (t instanceof HTMLElement && !t.closest('[role="dialog"], .c-panel, .c-palette')) lastOutside = t;
  }, true);
}

// When an overlay closes, put keyboard focus back where it was before it opened.
export function useReturnFocus(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const before = lastOutside;
    return () => { if (before?.isConnected) before.focus({ preventScroll: true }); };
  }, [open]);
}
