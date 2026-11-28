import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { analyzeCanvas } from '../../poc/q04/analysis';
import { recommendForAnalysis, type RecommendationSet } from '../../poc/q04/recommend';
import { applyFilmToSelection } from '../../poc/q04/integration/parameterPaste';

/**
 * Local film recommendation for the open photo. Analysis and ranking reuse the
 * CP1 PoC modules; applying a film goes through the same commit path as paste,
 * so it is one undo step on the open photo and persisted for the selection.
 */
export function RecommendHost() {
  const image = useEditorStore((state) => state.image);
  const entries = useWorkspaceStore((state) => state.entries);
  const stripHeight = useWorkspaceStore((state) => (state.collapsed ? 34 : state.height));
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<RecommendationSet | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open || !image?.previewCanvas) {
      setResult(null);
      return;
    }
    setResult(recommendForAnalysis(analyzeCanvas(image.previewCanvas), { limit: 3 }));
  }, [open, image]);

  if (!entries.length || !image) return null;

  const apply = (filmId: string, filmName: string) => {
    const report = applyFilmToSelection(filmId as Parameters<typeof applyFilmToSelection>[0]);
    setMessage(`${filmName} applied to ${report.pasted} photo${report.pasted === 1 ? '' : 's'}`);
  };

  return (
    <>
      <button
        type="button"
        data-testid="recommend-open"
        aria-label="Film recommendations"
        onClick={() => setOpen(true)}
        className="fixed left-4 z-30 flex items-center gap-2 rounded-full border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-121722)] px-3 py-2 text-xs font-semibold text-[color:var(--ui-text-slate200)] shadow-lg hover:border-amber-400"
        style={{ bottom: `calc(${stripHeight}px + 10.5rem)` }}
      >
        <Sparkles className="h-4 w-4 text-[color:var(--ui-text-amber-400)]" />
        Recommend
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Film recommendations"
            data-testid="recommend-dialog"
            className="flex max-h-[85vh] w-full max-w-xl flex-col gap-3 rounded-xl border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-111722)] p-5 text-[color:var(--ui-text-slate200)] shadow-xl"
            onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">Film Recommendation</h2>
                <p className="text-xs text-[color:var(--ui-text-slate400)]">{image.name} · analyzed locally, no upload</p>
              </div>
              <button type="button" aria-label="Close recommendations" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            </div>

            {!result && <p className="text-xs text-[color:var(--ui-text-slate400)]">Analyzing…</p>}

            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {(result?.recommendations ?? []).map((recommendation) => (
                <li key={recommendation.filmId} data-testid="recommend-card" data-score={Math.round(recommendation.score * 100)} className="rounded border border-[color:var(--ui-border-slate700)] px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <strong className="truncate">{recommendation.filmName}</strong>
                    <span className="shrink-0 text-[color:var(--ui-text-amber-400)]">{Math.round(recommendation.score * 100)}%</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-[color:var(--ui-text-slate400)]">{recommendation.summary}</p>
                  <button
                    type="button"
                    data-testid="recommend-apply"
                    onClick={() => apply(recommendation.filmId, recommendation.filmName)}
                    className="mt-2 rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white"
                  >
                    Apply {recommendation.filmName}
                  </button>
                </li>
              ))}
            </ul>

            {message && <p data-testid="recommend-status" role="status" className="text-xs text-[color:var(--ui-text-amber-400)]">{message}</p>}
          </div>
        </div>
      )}
    </>
  );
}
