import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

interface Toast {
  id: number;
  message: string;
  tone: 'error' | 'info';
}

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(
  () => undefined,
);

let nextId = 1;

/** Short messages in the corner, e.g. when a save fails. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = nextId++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto max-w-sm rounded-lg px-4 py-2 text-sm shadow-lg ${
              t.tone === 'error' ? 'bg-bad text-white' : 'bg-ink text-canvas'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
