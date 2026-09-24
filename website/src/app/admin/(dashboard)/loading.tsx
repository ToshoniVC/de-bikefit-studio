/**
 * Instant loading state for admin screens while their data loads. Renders
 * inside `AdminShell`, so the navigation stays visible. Existing utilities
 * only (no new CSS); the admin's look is owned by `src/components/admin/**`.
 */
export default function AdminLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Laden…</span>
      <div aria-hidden="true" className="mb-2 flex flex-col gap-3 border-b border-border pb-5">
        <div className="h-9 w-64 max-w-full animate-pulse bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse bg-muted" />
      </div>
      <div aria-hidden="true" className="h-40 animate-pulse border border-border bg-card" />
      <div aria-hidden="true" className="h-64 animate-pulse border border-border bg-card" />
    </div>
  );
}
