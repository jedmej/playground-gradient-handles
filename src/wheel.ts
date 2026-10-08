/**
 * The one wheel rule: raw deltaY > 0 = more (macOS natural scrolling: fingers up = more; classic mouse wheel: wheel down = more).
 * Flip `WHEEL_SIGN` to reverse every scroll control at once (-1 = deltaY < 0 is more, +1 = deltaY > 0 is more).
 * Pinch (ctrl + wheel) is not affected by natural scrolling: pinch out (deltaY < 0) always grows.
 * Returns the pixel-normalised amount, positive for "more". `useX` falls back to deltaX (Shift+wheel in Chromium on macOS).
 */
const WHEEL_SIGN = 1;

export function wheelUp(e: WheelEvent, useX = false): number {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const d = useX ? e.deltaY || e.deltaX : e.deltaY;
  const sign = e.ctrlKey ? -1 : WHEEL_SIGN;
  return sign * d * unit || 0;
}
