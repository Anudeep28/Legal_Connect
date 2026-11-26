import { Link } from 'wouter';
import type { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type AiRequestConsentDialogProps = {
  open: boolean;
  provider: 'DeepSeek' | 'ElevenLabs via Replit';
  description: string;
  testIdPrefix: string;
  continueLabel?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onContinue: () => void;
};

export function AiRequestConsentDialog({
  open,
  provider,
  description,
  testIdPrefix,
  continueLabel = 'Continue and send',
  returnFocusRef,
  onCancel,
  onContinue,
}: AiRequestConsentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent
        data-testid={`${testIdPrefix}-ai-consent-dialog`}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current;
          if (target?.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Before sending content to {provider}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Nothing is sent until you continue. Read the{' '}
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline underline-offset-4"
            data-testid={`${testIdPrefix}-ai-privacy-link`}
          >
            Privacy Policy
          </Link>{' '}
          for provider details.
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            data-testid={`${testIdPrefix}-ai-cancel`}
          >
            Cancel — don’t send
          </Button>
          <Button onClick={onContinue} data-testid={`${testIdPrefix}-ai-continue`}>
            {continueLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
