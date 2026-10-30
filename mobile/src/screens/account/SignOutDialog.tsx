import { Dialog } from '../../components/Ui';
import { useAccountCopy } from './use-account-copy';

export interface SignOutDialogProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation before ending the session; the caller runs the sign-out. */
export function SignOutDialog({ visible, onConfirm, onCancel }: SignOutDialogProps) {
  const copy = useAccountCopy();
  return (
    <Dialog
      visible={visible}
      title={copy.signOut.title}
      description={copy.signOut.body}
      confirmLabel={copy.signOut.confirm}
      cancelLabel={copy.common.cancel}
      onConfirm={onConfirm}
      onCancel={onCancel}
      destructive
    />
  );
}
