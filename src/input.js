// Pointer events unify mouse and touch. We hand the game five gestures:
// tap, longpress, pan, pinch (zoom about a point) and hover (mouse only).

import { LONG_PRESS_MS, TAP_SLOP_PX } from './constants.js';

export function attachInput(canvas, handlers) {
  const pointers = new Map(); // pointerId -> { x, y, sx, sy }
  let longTimer = null;
  let moved = false;         // once true, the gesture is a pan/pinch, never a tap
  let pinchDist = 0;

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clearLong = () => { if (longTimer) { clearTimeout(longTimer); longTimer = null; } };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, { ...p, sx: p.x, sy: p.y });
    if (pointers.size === 1) {
      moved = false;
      clearLong();
      longTimer = setTimeout(() => {
        // Finger is still down and has not travelled: treat as long-press.
        longTimer = null;
        if (pointers.size === 1 && !moved) {
          moved = true; // swallow the tap that would otherwise fire on up
          handlers.onLongPress?.(p.x, p.y);
        }
      }, LONG_PRESS_MS);
    } else {
      // Second finger: no tap, no long-press; start measuring the pinch.
      clearLong();
      moved = true;
      pinchDist = distance();
    }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') { const p = local(e); handlers.onHover?.(p.x, p.y); }
      return;
    }
    const p = local(e);
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { ...prev, x: p.x, y: p.y });
    if (pointers.size === 1) {
      if (!moved && Math.hypot(p.x - prev.sx, p.y - prev.sy) > TAP_SLOP_PX) { moved = true; clearLong(); }
      if (moved) handlers.onPan?.(p.x - prev.x, p.y - prev.y);
    } else if (pointers.size === 2) {
      const d = distance();
      const c = centre();
      if (pinchDist > 0 && d > 0) handlers.onPinch?.(c.x, c.y, d / pinchDist);
      pinchDist = d;
    }
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    clearLong();
    if (pointers.size === 0 && !moved && e.type === 'pointerup') handlers.onTap?.(p.x, p.y);
    // Dropping from two fingers to one: the pan baseline is the remaining
    // pointer's last position already; just forget the pinch distance.
    if (pointers.size === 1) pinchDist = 0;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') handlers.onHover?.(null, null); });

  // Desktop: wheel zooms about the cursor.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    handlers.onPinch?.(p.x, p.y, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function distance() {
    const [a, b] = pointers.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function centre() {
    const [a, b] = pointers.values();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}
