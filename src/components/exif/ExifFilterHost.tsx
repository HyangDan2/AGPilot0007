import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { MetadataIndex, type IndexProgress, type IndexReport, type MetadataQuery } from '../../poc/q04/metadata';

const SORTS: Array<{ value: NonNullable<MetadataQuery['sort']>; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'date-asc', label: 'Date ↑' },
  { value: 'date-desc', label: 'Date ↓' },
  { value: 'iso-asc', label: 'ISO ↑' },
  { value: 'iso-desc', label: 'ISO ↓' },
];

const splitTerms = (value: string): string[] | undefined => {
  const terms = value.split(/[,;]+/).map((term) => term.trim()).filter(Boolean);
  return terms.length ? terms : undefined;
};

const numberOrUndefined = (value: string): number | undefined => {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Local EXIF search over the workspace entries. The index is built on demand
 * with exifr header parsing only; nothing leaves the device.
 */
export function ExifFilterHost() {
  const entries = useWorkspaceStore((state) => state.entries);
  const stripHeight = useWorkspaceStore((state) => (state.collapsed ? 34 : state.height));
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [camera, setCamera] = useState('');
  const [lens, setLens] = useState('');
  const [isoMin, setIsoMin] = useState('');
  const [isoMax, setIsoMax] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState<NonNullable<MetadataQuery['sort']>>('name');
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [report, setReport] = useState<IndexReport | null>(null);
  const [version, setVersion] = useState(0);
  const index = useRef(new MetadataIndex());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || !entries.length) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    void index.current
      .index(entries, { signal: controller.signal, onProgress: (next) => { if (!controller.signal.aborted) setProgress(next); } })
      .then((next) => {
        if (controller.signal.aborted) return;
        setProgress(null);
        setReport(next);
        setVersion((value) => value + 1);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [open, entries]);

  useEffect(() => () => {
    abortRef.current?.abort();
    index.current.clear();
  }, []);

  const results = useMemo(() => {
    void version;
    return index.current.search({
      text,
      models: splitTerms(camera),
      lens: splitTerms(lens),
      isoMin: numberOrUndefined(isoMin),
      isoMax: numberOrUndefined(isoMax),
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      sort,
    });
  }, [version, text, camera, lens, isoMin, isoMax, dateFrom, dateTo, sort]);

  if (!entries.length) return null;

  const openPhoto = (id: string) => {
    void useWorkspaceStore.getState().select(id);
    setOpen(false);
  };

  const indexing = progress && progress.active > 0;

  return (
    <>
      <button
        type="button"
        data-testid="exif-open"
        aria-label="EXIF search"
        onClick={() => setOpen(true)}
        className="fixed left-4 z-30 flex items-center gap-2 rounded-full border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-121722)] px-3 py-2 text-xs font-semibold text-[color:var(--ui-text-slate200)] shadow-lg hover:border-amber-400"
        style={{ bottom: `calc(${stripHeight}px + 7.5rem)` }}
      >
        <Search className="h-4 w-4 text-[color:var(--ui-text-amber-400)]" />
        EXIF
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="EXIF search"
            data-testid="exif-dialog"
            className="flex max-h-[85vh] w-full max-w-xl flex-col gap-3 rounded-xl border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-111722)] p-5 text-[color:var(--ui-text-slate200)] shadow-xl"
            onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">EXIF Search</h2>
                <p className="text-xs text-[color:var(--ui-text-slate400)]">
                  {indexing ? `Indexing ${progress.indexed}/${progress.total}…` : report ? `Indexed ${index.current.size} · ${report.failed} failed` : 'Indexing…'}
                </p>
              </div>
              <button type="button" aria-label="Close EXIF search" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <input data-testid="exif-text" aria-label="Search text" placeholder="Name, camera, date…" value={text} onChange={(event) => setText(event.target.value)} className="col-span-2 rounded border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-0d1119)] px-2 py-1" />
              <input data-testid="exif-camera" aria-label="Camera" placeholder="Camera model" value={camera} onChange={(event) => setCamera(event.target.value)} className="rounded border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-0d1119)] px-2 py-1" />
              <input data-testid="exif-lens" aria-label="Lens" placeholder="Lens" value={lens} onChange={(event) => setLens(event.target.value)} className="rounded border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-0d1119)] px-2 py-1" />
              <input data-testid="exif-iso-min" aria-label="ISO min" type="number" placeholder="ISO min" value={isoMin} onChange={(event) => setIsoMin(event.target.value)} className="rounded border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-0d1119)] px-2 py-1" />
              <input data-testid="exif-iso-max" aria-label="ISO max" type="number" placeholder="ISO max" value={isoMax} onChange={(event) => setIsoMax(event.target.value)} className="rounded border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-0d1119)] px-2 py-1" />
              <input data-testid="exif-date-from" aria-label="Date from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="rounded border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-0d1119)] px-2 py-1" />
              <input data-testid="exif-date-to" aria-label="Date to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="rounded border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-0d1119)] px-2 py-1" />
              <select data-testid="exif-sort" aria-label="Sort results" value={sort} onChange={(event) => setSort(event.target.value as NonNullable<MetadataQuery['sort']>)} className="rounded border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-0d1119)] px-2 py-1">
                {SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>

            <ul data-testid="exif-results" className="min-h-0 flex-1 overflow-y-auto rounded border border-[color:var(--ui-border-slate700)]">
              {results.length === 0 && <li className="px-3 py-2 text-xs text-[color:var(--ui-text-slate500)]">No matches</li>}
              {results.slice(0, 200).map((record) => (
                <li key={record.id} className="border-b border-[color:var(--ui-border-slate700)]/60 last:border-b-0">
                  <button type="button" data-testid="exif-result" onClick={() => openPhoto(record.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--ui-bg-121722)]">
                    <span className="min-w-0 flex-1 truncate" title={record.path}>{record.name}</span>
                    <span className="shrink-0 text-[color:var(--ui-text-slate400)]">
                      {[record.cameraModel, record.iso ? `ISO ${record.iso}` : '', record.captureDate].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
