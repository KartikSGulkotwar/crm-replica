import { ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A floating panel anchored below an element. Rendered in a portal so it isn't clipped by
 * scrolling containers (like the table). Closes on outside click or Escape.
 */
export function Popover({
  anchor,
  onClose,
  children,
  width = 260,
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    function place() {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = rect.bottom + 4;
      const height = panel.current?.offsetHeight ?? 0;
      const top =
        below + height > window.innerHeight - 8 && rect.top > height
          ? rect.top - height - 4
          : below;
      setPos({ top, left });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, width]);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panel}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
      className="fixed z-50 max-w-[calc(100vw-16px)] rounded-lg border border-line bg-surface p-1 text-sm shadow-lg"
    >
      {children}
    </div>,
    document.body,
  );
}
