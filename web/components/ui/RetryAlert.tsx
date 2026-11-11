import Alert from "@/components/ui/Alert";

// Falla recuperable (red, servidor): el mensaje y un botón para reintentar, nunca una pantalla sin salida.
export default function RetryAlert({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert tone="danger" data-testid="retry-alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry}
        className="mt-2 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-red-800 shadow-sm hover:bg-red-100">
        Reintentar
      </button>
    </Alert>
  );
}
