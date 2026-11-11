export default function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Pasos">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                state === "todo" ? "bg-surface text-muted" : "bg-accent text-white"}`}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className={`hidden text-sm sm:inline ${state === "current" ? "font-semibold text-ink" : "text-muted"}`}>
              {label}
            </span>
            {i < steps.length - 1 && <span className="h-px flex-1 bg-line" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
