import { X } from 'lucide-react';
import { ReactNode, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';

/** A modal dialog: Escape or the backdrop closes it. Full-screen sheet on phones. */
export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full flex-col rounded-t-xl border border-line bg-surface shadow-xl sm:max-w-lg sm:rounded-xl"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id={titleId} className="font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted hover:bg-raised hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
