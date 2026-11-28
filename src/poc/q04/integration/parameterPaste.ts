import { useEditorStore } from '../../../stores/editorStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { createEditState, copyParameters, pasteParameters } from '../editState';
import { primarySelection } from '../selection';
import type { EditState, ParameterClip, ParameterGroup } from '../types';
import type { FilmId } from '../../../types/film';
import { editStateFromEditor } from './editStateBridge';

let clipboard: ParameterClip | null = null;

export function clipboardClip(): ParameterClip | null {
  return clipboard;
}

export function clearClipboard(): void {
  clipboard = null;
}

/** Live editor state for the open photo, the saved session otherwise, defaults last. */
export function readEditState(id: string): EditState {
  const editor = useEditorStore.getState();
  if (editor.image?.workspaceKey === id) return editStateFromEditor(editor);
  return useWorkspaceStore.getState().savedEditState(id) ?? createEditState();
}

function sameEditState(a: EditState, b: EditState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Commits a whole-group patch as one history entry through Q01's
 * applyParameterGroups, which carries all edit groups (v7 fields plus geometry,
 * optical and localAdjustments) in the shared snapshot format.
 */
export function commitEditStateToEditor(next: EditState): void {
  const editor = useEditorStore.getState();
  if (sameEditState(editStateFromEditor(editor), next)) return;
  editor.applyParameterGroups({
    film: { filmId: next.activeFilmId, presetId: next.activePresetId },
    adjustments: next.adjustments,
    curves: next.curves,
    camera: next.camera,
    colorMixer: next.colorMixer,
    sharpening: next.sharpening,
    geometry: next.geometry,
    optical: next.optical,
    localAdjustments: next.localAdjustments,
  });
}

/** Reads the clip source (primary selection, else the open photo). */
export function copySelection(groups: readonly ParameterGroup[]): ParameterClip | null {
  const workspace = useWorkspaceStore.getState();
  const source = primarySelection(workspace.selection) ?? workspace.activeId;
  if (!source || !groups.length) return null;
  clipboard = copyParameters(source, readEditState(source), groups);
  return clipboard;
}

export interface PasteReport {
  pasted: number;
  /** Photo whose paste went through the editor history (one undo step). */
  active: string | null;
}

/**
 * Pastes into every selected photo. The open photo commits through the editor
 * history; the rest write their saved session so they keep the values without
 * being opened. With an empty selection the open photo is the target.
 */
export function pasteToSelection(clip: ParameterClip | null = clipboard): PasteReport {
  if (!clip) return { pasted: 0, active: null };
  const workspace = useWorkspaceStore.getState();
  const editor = useEditorStore.getState();
  const ids = workspace.selection.ids.length ? workspace.selection.ids : workspace.activeId ? [workspace.activeId] : [];
  let active: string | null = null;
  for (const id of ids) {
    if (id === workspace.activeId && editor.image?.workspaceKey === id) {
      commitEditStateToEditor(pasteParameters(editStateFromEditor(editor), clip));
      active = id;
    } else {
      workspace.updateSession(id, pasteParameters(workspace.savedEditState(id) ?? createEditState(), clip));
    }
  }
  return { pasted: ids.length, active };
}

/** One-click film apply for the recommendation panel; same commit path as paste. */
export function applyFilmToSelection(filmId: FilmId): PasteReport {
  return pasteToSelection({ sourceId: 'recommend', groups: ['film'], film: { activeFilmId: filmId, activePresetId: null } });
}
