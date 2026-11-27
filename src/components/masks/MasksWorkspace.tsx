import { useMaskUiStore } from '../../stores/maskUiStore';
import { MaskListPanel, type MaskListPanelProps } from './MaskListPanel';
import { MaskOverlay, type MaskOverlayProps } from './MaskOverlay';

type BoundProps = {
  disabled?: boolean;
  className?: string;
};

/** Mask panel bound to the shared mask UI store; drop into the side panel. */
export function MaskControls({ disabled, className }: BoundProps) {
  const store = useMaskUiStore();
  const props: MaskListPanelProps = {
    local: store.local,
    selectedGroupId: store.selectedGroupId,
    selectedMaskId: store.selectedMaskId,
    notice: store.notice,
    disabled,
    className,
    onToggleLocal: store.setEnabled,
    onSelectGroup: store.selectGroup,
    onAddGroup: store.addGroup,
    onRemoveGroup: store.removeGroup,
    onUpdateGroup: store.updateGroup,
    onGroupAdjustment: store.setGroupAdjustment,
    onAddMask: store.addMask,
    onRemoveMask: store.removeMask,
    onSelectMask: store.selectMask,
    onUpdateMask: store.updateMask,
    onDismissNotice: store.clearNotice,
  };
  return <MaskListPanel {...props} />;
}

/** Mask editing overlay bound to the shared mask UI store; drop over the viewport. */
export function MaskEditingOverlay({
  aspect,
  hidden,
  className,
  onDragStart,
  onDragEnd,
}: Pick<MaskOverlayProps, 'aspect' | 'hidden' | 'className' | 'onDragStart' | 'onDragEnd'>) {
  const group = useMaskUiStore((state) =>
    state.local.groups.find((candidate) => candidate.id === state.selectedGroupId),
  );
  const selectedMaskId = useMaskUiStore((state) => state.selectedMaskId);
  const updateMask = useMaskUiStore((state) => state.updateMask);
  return (
    <MaskOverlay
      group={group ?? null}
      selectedMaskId={selectedMaskId}
      aspect={aspect}
      hidden={hidden}
      className={className}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMaskChange={(maskId, patch) => {
        if (group) updateMask(group.id, maskId, patch);
      }}
    />
  );
}
