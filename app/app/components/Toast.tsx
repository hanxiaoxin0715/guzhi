"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { X, CheckCircle, AlertCircle, Info } from "lucide-react";

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastContextType {
  toast: (message: string, type?: ToastItem["type"]) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback(
    (message: string, type: ToastItem["type"] = "info") => {
      const id = Date.now() * 1000 + Math.floor(Math.random() * 1000000);
      setToasts((prev) => [...prev, { id, message, type }]);
      // 错误消息显示更久（8秒），普通消息 3.5 秒
      const duration = type === "error" ? 8000 : 3500;
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    },
    []
  );

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Memoize context value so consumers don't re-render when toasts array changes
  const contextValue = useMemo(() => ({ toast: addToast }), [addToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="fixed bottom-6 left-6 z-[9999] flex flex-col-reverse gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-start gap-3 px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border-default)] shadow-2xl pointer-events-auto animate-[slideIn_0.25s_ease-out] min-w-[300px] max-w-[560px]"
          >
            {t.type === "success" && (
              <CheckCircle size={16} className="text-[#4ade80] shrink-0" />
            )}
            {t.type === "error" && (
              <AlertCircle size={16} className="text-[#ef4444] shrink-0" />
            )}
            {t.type === "info" && (
              <Info size={16} className="text-[var(--gold-primary)] shrink-0" />
            )}
            <span className="text-[13px] text-[var(--text-primary)] flex-1 whitespace-pre-wrap">
              {t.message}
            </span>
            <button
              onClick={() => removeToast(t.id)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
