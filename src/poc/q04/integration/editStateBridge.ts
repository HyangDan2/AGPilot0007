import { useEditorStore } from '../../../stores/editorStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { createEditState, EditStateRegistry } from '../editState';
import type { EditState } from '../types';
import type { AdjustmentSettings, FilmId } from '../../../types/film';
import type { CameraSettings } from '../../../types/camera';
import type { ColorMixerSettings } from '../../../types/colorMixer';
import type { ToneCurves } from '../../../types/curves';
import type { SharpeningSettings } from '../../../types/sharpening';

interface EditorSnapshot {
  activeFilmId: FilmId;
  activePresetId: string | null;
  adjustments: AdjustmentSettings;
  curves: ToneCurves;
  camera: CameraSettings;
  colorMixer: ColorMixerSettings;
  sharpening: SharpeningSettings;
  image: { workspaceKey?: string } | null;
}

interface WorkspaceSnapshot {
  entries: ReadonlyArray<{ id: string }>;
  name: string;
}

export interface EditorSource {
  getState(): EditorSnapshot;
  subscribe(listener: (next: EditorSnapshot, previous: EditorSnapshot) => void): () => void;
}

export interface WorkspaceSource {
  subscribe(listener: (next: WorkspaceSnapshot, previous: WorkspaceSnapshot) => void): () => void;
}

/** editorStore keeps a superset of an EditState; this is the batch-facing projection. */
export function editStateFromEditor(snapshot: EditorSnapshot): EditState {
  return createEditState({
    activeFilmId: snapshot.activeFilmId,
    activePresetId: snapshot.activePresetId,
    adjustments: snapshot.adjustments,
    curves: snapshot.curves,
    camera: snapshot.camera,
    colorMixer: snapshot.colorMixer,
    sharpening: snapshot.sharpening,
  });
}

/**
 * Mirrors workspaceStore's per-photo session behaviour for the batch queue without
 * touching the shared store: the outgoing photo's edit state is captured when the
 * editor image changes, so a batch run sees the same edits the user saw. Photos
 * that were never opened export from a fresh EditState. IF-03 (shared selection
 * contract) stays deferred; this bridge only reads public stores.
 */
export class EditorEditStateBridge {
  private readonly registry = new EditStateRegistry();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly editor: EditorSource = useEditorStore as unknown as EditorSource,
    workspace: WorkspaceSource = useWorkspaceStore as unknown as WorkspaceSource,
  ) {
    this.unsubscribers.push(editor.subscribe((next, previous) => this.captureOutgoing(previous, next)));
    this.unsubscribers.push(workspace.subscribe((next, previous) => this.syncEntries(next, previous)));
  }

  private captureOutgoing(previous: EditorSnapshot, next: EditorSnapshot): void {
    const key = previous.image?.workspaceKey;
    if (next.image === previous.image || !key) return;
    this.registry.set(key, editStateFromEditor(previous));
  }

  private syncEntries(next: WorkspaceSnapshot, previous: WorkspaceSnapshot): void {
    if (next.name !== previous.name) {
      this.registry.clear();
      return;
    }
    if (next.entries === previous.entries) return;
    const ids = new Set(next.entries.map((entry) => entry.id));
    for (const id of this.registry.ids()) {
      if (!ids.has(id)) this.registry.delete(id);
    }
  }

  /** Live state for the active photo, mirrored state for visited photos, fresh otherwise. */
  editFor(id: string): EditState {
    const editor = this.editor.getState();
    if (editor.image?.workspaceKey === id) return editStateFromEditor(editor);
    const saved = this.registry.get(id);
    return saved ? createEditState(saved) : createEditState();
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.registry.clear();
  }
}
