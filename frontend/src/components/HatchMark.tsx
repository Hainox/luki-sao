/** Знак приложения — крышка люка (тот же рисунок, что в иконке PWA). */
export function HatchMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#fff" fillOpacity="0.14" />
      <circle cx="32" cy="32" r="20" fill="none" stroke="#fff" strokeWidth="4.5" />
      <circle cx="32" cy="32" r="11" fill="none" stroke="#fff" strokeWidth="3" />
      <path d="M32 12v40M12 32h40" stroke="#fff" strokeWidth="3" />
    </svg>
  )
}
