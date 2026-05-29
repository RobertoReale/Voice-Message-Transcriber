/**
 * Makes a panel element draggable via a handle element.
 * Returns an AbortController — call `.abort()` to remove all listeners
 * (e.g. when the panel is destroyed and recreated).
 * `onPositionChange` is called after each completed drag with the final CSS left/top values.
 */
export function makeDraggable(
  panelEl: HTMLElement,
  handle: HTMLElement,
  onPositionChange?: (left: string, top: string) => void,
): AbortController {
  const ac = new AbortController();
  const { signal } = ac;

  let dragging = false;
  let moved = false;
  let ox = 0;
  let oy = 0;

  handle.style.cursor = 'move';

  handle.addEventListener(
    'mousedown',
    (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      dragging = true;
      moved = false;
      const rect = panelEl.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      panelEl.style.transition = 'none';
      e.preventDefault();
    },
    { signal },
  );

  document.addEventListener(
    'mousemove',
    (e) => {
      if (!dragging) return;
      moved = true;
      const maxLeft = window.innerWidth - panelEl.offsetWidth;
      const maxTop = window.innerHeight - panelEl.offsetHeight;
      panelEl.style.left = `${Math.max(0, Math.min(maxLeft, e.clientX - ox))}px`;
      panelEl.style.top = `${Math.max(0, Math.min(maxTop, e.clientY - oy))}px`;
    },
    { signal },
  );

  document.addEventListener(
    'mouseup',
    () => {
      if (dragging && moved) {
        onPositionChange?.(panelEl.style.left, panelEl.style.top);
      }
      dragging = false;
      moved = false;
    },
    { signal },
  );

  return ac;
}
