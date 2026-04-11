import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Système de toast minimal sans dépendance externe.
// Usage : `const { toast } = useToast(); toast("✓ Enregistré");`
// Variantes : "success" (vert), "error" (rouge), "info" (gris/pine).

type ToastType = "success" | "error" | "info";
type Toast = { id: number; message: string; type: ToastType };
type ToastContextValue = {
  toast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const toast = useCallback((message: string, type: ToastType = "success") => {
    const id = ++nextId.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    // auto-dismiss après 2.5s (success/info) ou 4s (error, laisse le temps de lire)
    const delay = type === "error" ? 4000 : 2500;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, delay);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const bg =
    toast.type === "success"
      ? "bg-pine text-white"
      : toast.type === "error"
        ? "bg-red-600 text-white"
        : "bg-gray-800 text-white";
  return (
    <div
      className={`${bg} px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium pointer-events-auto transition-all duration-200 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      }`}
    >
      {toast.message}
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // fallback silencieux plutôt que de casser le composant si le provider manque
    return { toast: () => {} };
  }
  return ctx;
}
