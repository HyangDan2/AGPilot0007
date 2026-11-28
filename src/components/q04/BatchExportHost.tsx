import { useEffect, useMemo, useState } from 'react';
import { Images, X } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { BatchExportController, type BatchExportView } from '../../poc/q04/integration/batchController';
import { readEditState } from '../../poc/q04/integration/parameterPaste';

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Rendering',
  succeeded: 'Saved',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/**
 * CP2-05/CP3 product entry for the batch queue. The workspace selection is the
 * single source of truth for what runs; per-photo edits come from the bridge,
 * and cancellation/progress/retry ride on the shared BatchQueue + ExportControl.
 */
export function BatchExportHost() {
  const entries = useWorkspaceStore((state) => state.entries);
  const selection = useWorkspaceStore((state) => state.selection);
  const stripHeight = useWorkspaceStore((state) => (state.collapsed ? 34 : state.height));
  const [open, setOpen] = useState(false);
  const { controller } = useMemo(() => {
    const controllerInstance = new BatchExportController();
    controllerInstance.setEntries(useWorkspaceStore.getState().entries);
    return { controller: controllerInstance };
  }, []);
  const [view, setView] = useState<BatchExportView | null>(null);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setView);
    return () => {
      unsubscribe();
      controller.destroy();
    };
  }, [controller]);

  useEffect(() => {
    controller.setEntries(entries);
  }, [controller, entries]);

  if (!entries.length) return null;

  // Video is not batched (CP4): the queue lists and exports photos only.
  const photoEntries = entries.filter((entry) => entry.kind !== 'video');
  const photoIds = new Set(photoEntries.map((entry) => entry.id));
  const jobs = new Map((view?.snapshot?.jobs ?? []).map((job) => [job.id, job]));
  const selected = selection.ids.filter((id) => photoIds.has(id));
  const running = view?.running ?? false;
  const summary = view?.summary ?? null;
  const progress = Math.round((view?.snapshot?.overallProgress ?? 0) * 100);
  const retryable = (view?.snapshot?.jobs ?? []).filter((job) => job.status === 'failed' || job.status === 'cancelled').length;

  if (!photoEntries.length) return null;
  return (
    <>
      <button
        type="button"
        data-testid="batch-export-open"
        aria-label="Batch export"
        onClick={() => setOpen(true)}
        className="fixed left-4 z-30 flex items-center gap-2 rounded-full border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-121722)] px-3 py-2 text-xs font-semibold text-[color:var(--ui-text-slate200)] shadow-lg hover:border-amber-400"
        style={{ bottom: `calc(${stripHeight}px + 1.5rem)` }}
      >
        <Images className="h-4 w-4 text-[color:var(--ui-text-amber-400)]" />
        Batch
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Batch export"
            data-testid="batch-export-dialog"
            className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-111722)] p-5 text-[color:var(--ui-text-slate200)] shadow-xl"
            onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Batch Export</h2>
                <p className="text-xs text-[color:var(--ui-text-slate400)]">{photoEntries.length} photos · {selected.length} selected</p>
              </div>
              <button type="button" aria-label="Close batch export" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <button type="button" data-testid="batch-export-select-all" onClick={() => useWorkspaceStore.getState().selectAllPhotos()} disabled={running} className="rounded border border-[color:var(--ui-border-slate600)] px-2 py-1 hover:border-amber-400">Select all</button>
              <button type="button" data-testid="batch-export-clear" onClick={() => useWorkspaceStore.getState().clearSelection()} disabled={running} className="rounded border border-[color:var(--ui-border-slate600)] px-2 py-1 hover:border-amber-400">Clear</button>
              <button
                type="button"
                data-testid="batch-export-start"
                onClick={() => controller.start(selected, (id) => readEditState(id))}
                disabled={running || selected.length === 0}
                className="rounded bg-amber-600 px-3 py-1 font-semibold text-white disabled:opacity-40"
              >
                Export selected
              </button>
              {running && (
                <button type="button" data-testid="batch-export-cancel-all" onClick={() => controller.cancelAll()} className="rounded border border-red-400/60 px-2 py-1 text-red-300">Cancel all</button>
              )}
              {retryable > 0 && (
                <button type="button" data-testid="batch-export-retry-failed" onClick={() => controller.retryFailed()} className="rounded border border-amber-400/60 px-2 py-1 text-amber-300">Retry failed</button>
              )}
            </div>

            {view?.snapshot && (
              <div className="mb-2">
                <div className="h-1.5 w-full overflow-hidden rounded bg-[var(--ui-bg-slate700)]/40">
                  <div className="h-full bg-amber-500 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p data-testid="batch-export-progress" className="mt-1 text-xs text-[color:var(--ui-text-slate400)]">{progress}% · running {view.snapshot.counts.running} · queued {view.snapshot.counts.queued}</p>
              </div>
            )}

            <ul data-testid="batch-export-list" className="min-h-0 flex-1 overflow-y-auto rounded border border-[color:var(--ui-border-slate700)]">
              {photoEntries.map((entry) => {
                const job = jobs.get(entry.id);
                const checked = selected.includes(entry.id);
                return (
                  <li key={entry.id} data-testid="batch-export-item" data-status={job?.status ?? 'idle'} className="flex items-center gap-3 border-b border-[color:var(--ui-border-slate700)]/60 px-3 py-1.5 text-xs last:border-b-0">
                    <input type="checkbox" aria-label={`Select ${entry.name}`} checked={checked} disabled={running} onChange={() => useWorkspaceStore.getState().toggleSelection(entry.id)} />
                    <span className="min-w-0 flex-1 truncate" title={entry.path}>{entry.name}</span>
                    {job && (
                      <>
                        <span className="shrink-0 text-[color:var(--ui-text-slate400)]" data-progress={Math.round(job.progress * 100)}>
                          {STATUS_LABEL[job.status] ?? job.status}
                          {job.status === 'running' && ` ${Math.round(job.progress * 100)}%`}
                          {job.error ? `: ${job.error}` : ''}
                        </span>
                        {(job.status === 'running' || job.status === 'queued') && (
                          <button type="button" aria-label={`Cancel ${entry.name}`} onClick={() => controller.cancel(entry.id)} className="shrink-0 text-red-300">×</button>
                        )}
                        {(job.status === 'failed' || job.status === 'cancelled') && (
                          <button type="button" aria-label={`Retry ${entry.name}`} onClick={() => controller.retry(entry.id)} className="shrink-0 text-amber-300">↻</button>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>

            {summary && (
              <div className="mt-3 text-xs text-[color:var(--ui-text-slate300)]">
                <p data-testid="batch-export-summary">
                  {summary.succeeded}/{summary.total} saved · failed {summary.failed} · cancelled {summary.cancelled} · delivery failed {summary.deliveryFailed}
                </p>
                <p data-testid="batch-export-reconciled" data-ok={summary.reconciled ? 'true' : 'false'} className={summary.reconciled ? 'text-[color:var(--ui-text-slate400)]' : 'text-red-300'}>
                  selected {summary.total} = saved {summary.succeeded} + failed {summary.failed} + cancelled {summary.cancelled}{summary.reconciled ? '' : ' · mismatch'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
