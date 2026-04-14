import { Eye, FileText, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'

export type ExportPreviewDialogProps = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  previewError?: string | null
  previewHtml: string
  previewLoading: boolean
}

/** Dialog that renders the current generated export HTML plus loading/error states. */
function ExportPreviewDialog({
  isOpen,
  onOpenChange,
  previewError,
  previewHtml,
  previewLoading,
}: ExportPreviewDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="preview-dialog__content">
        <div className="preview-dialog__header-row">
          <DialogHeader>
            <p className="eyebrow">Preview</p>
            <DialogTitle>Export preview</DialogTitle>
            <DialogDescription>
              Current one-file export output using your active replay settings
            </DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button
              aria-label="Close export preview"
              className="preview-block__action preview-block__action--icon"
              size="sm"
              variant="ghost"
            >
              <X size={16} strokeWidth={1.8} />
            </Button>
          </DialogClose>
        </div>

        <div className="preview-dialog__body">
          {previewError ? (
            <div className="preview-dialog__state">
              <p className="preview-dialog__state-title">Preview unavailable</p>
              <p className="preview-block__hint">Preview error: {previewError}</p>
            </div>
          ) : previewLoading && !previewHtml ? (
            <div className="preview-dialog__state">
              <p className="preview-dialog__state-title">Rendering preview…</p>
              <p className="preview-block__hint">Building export view with current settings</p>
            </div>
          ) : previewHtml ? (
            <div className="preview-dialog__frame-shell">
              {previewLoading ? (
                <p className="preview-dialog__status">
                  <Eye size={14} strokeWidth={1.8} />
                  Refreshing preview…
                </p>
              ) : null}
              <iframe className="preview-dialog__frame" title="Replay export preview" srcDoc={previewHtml} />
            </div>
          ) : (
            <div className="preview-dialog__state">
              <p className="preview-dialog__state-title">Preview unavailable</p>
              <p className="preview-block__hint">
                <FileText size={14} strokeWidth={1.8} />
                Generate a preview after selecting a session
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { ExportPreviewDialog }
