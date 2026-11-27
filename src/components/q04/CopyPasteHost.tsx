import { useState } from 'react';
import { ClipboardPaste, X } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useEditorStore } from '../../stores/editorStore';
import { GROUP_LABELS, PARAMETER_GROUPS, type ParameterGroup } from '../../poc/q04/types';
import { primarySelection } from '../../poc/q04/selection';
import { clipboardClip, copySelection, pasteToSelection } from '../../poc/q04/integration/parameterPaste';

/**
 * Selective copy/paste for the workspace selection. Copy reads the primary
 * selection (the open photo); paste writes the active photo through one undo
 * step and every other selected photo through its saved session.
 */
export function CopyPasteHost() {
  const entries = useWorkspaceStore((state) => state.entries);
  const selection = useWorkspaceStore((state) => state.selection);
  const activeId = useWorkspaceStore((state) => state.activeId);
  const image = useEditorStore((state) => state.image);
  const stripHeight = useWorkspaceStore((state) => (state.collapsed ? 34 : state.height));
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<ParameterGroup[]>([...PARAMETER_GROUPS]);
  const [message, setMessage] = useState('');

  if (!entries.length || !activeId || !image) return null;

  const clip = clipboardClip();
  const sourceId = primarySelection(selection) ?? activeId;
  const sourceName = entries.find((entry) => entry.id === sourceId)?.name ?? '';
  const targetIds = selection.ids.length ? selection.ids : [activeId];
  const toggleGroup = (group: ParameterGroup) =>
    setGroups((current) => (current.includes(group) ? current.filter((item) => item !== group) : [...current, group]));

  const copy = () => {
    const result = copySelection(groups);
    setMessage(result ? `Copied ${result.groups.length} groups from ${sourceName}` : 'Choose at least one group.');
  };

  const paste = () => {
    const report = pasteToSelection(clip);
    setMessage(report.pasted ? `Pasted to ${report.pasted} photo${report.pasted === 1 ? '' : 's'}` : 'Nothing to paste.');
  };

  return (
    <>
      <button
        type="button"
        data-testid="copy-paste-open"
        aria-label="Copy and paste parameters"
        onClick={() => setOpen(true)}
        className="fixed left-4 z-30 flex items-center gap-2 rounded-full border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-121722)] px-3 py-2 text-xs font-semibold text-[color:var(--ui-text-slate200)] shadow-lg hover:border-amber-400"
        style={{ bottom: `calc(${stripHeight}px + 4.5rem)` }}
      >
        <ClipboardPaste className="h-4 w-4 text-[color:var(--ui-text-amber-400)]" />
        Copy/Paste
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Copy and paste parameters"
            data-testid="copy-paste-dialog"
            className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-xl border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-111722)] p-5 text-[color:var(--ui-text-slate200)] shadow-xl"
            onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">Copy / Paste</h2>
                <p className="text-xs text-[color:var(--ui-text-slate400)]">Source: {sourceName || '—'} · targets: {targetIds.length} photo{targetIds.length === 1 ? '' : 's'}</p>
              </div>
              <button type="button" aria-label="Close copy paste" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            </div>

            <fieldset className="grid grid-cols-2 gap-1 text-xs">
              <legend className="mb-1 text-[color:var(--ui-text-slate400)]">Groups</legend>
              {PARAMETER_GROUPS.map((group) => (
                <label key={group} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    data-testid={`copy-group-${group}`}
                    checked={groups.includes(group)}
                    onChange={() => toggleGroup(group)}
                  />
                  {GROUP_LABELS[group]}
                </label>
              ))}
            </fieldset>

            <div className="flex flex-wrap gap-2 text-xs">
              <button type="button" data-testid="copy-parameters" onClick={copy} disabled={!groups.length} className="rounded border border-[color:var(--ui-border-slate600)] px-2 py-1 hover:border-amber-400 disabled:opacity-40">Copy</button>
              <button type="button" data-testid="paste-parameters" onClick={paste} disabled={!clip || !groups.length} className="rounded bg-amber-600 px-3 py-1 font-semibold text-white disabled:opacity-40">Paste to {targetIds.length}</button>
              {clip && <span className="self-center text-[color:var(--ui-text-slate400)]">clipboard: {clip.groups.join(', ')}</span>}
            </div>

            {message && <p data-testid="copy-paste-status" role="status" className="text-xs text-[color:var(--ui-text-amber-400)]">{message}</p>}
          </div>
        </div>
      )}
    </>
  );
}
