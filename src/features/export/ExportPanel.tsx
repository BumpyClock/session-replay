import { FileText, X } from 'lucide-react'
import { type ChangeEvent } from 'react'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'

/** Render options shared by export generation and export preview. */
export type ExportOptions = {
  filename: string
  title: string
  includeToolCalls: boolean
  includeThinking: boolean
  revealThinking: boolean
  includeTimestamps: boolean
}

/** Settings dialog state for the generated one-file replay output. */
export type ExportPanelProps = {
  options: ExportOptions
  canExport: boolean
  error?: string | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onOptionChange: (next: ExportOptions) => void
}

function ExportPanel({
  options,
  canExport,
  error,
  isOpen,
  onOpenChange,
  onOptionChange,
}: ExportPanelProps) {
  const updateText = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target
    onOptionChange({ ...options, [name]: value })
  }

  const updateBoolean = (name: keyof ExportOptions, checked: boolean) => {
    onOptionChange({ ...options, [name]: checked })
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="export-dialog__content">
        <div className="export-dialog__header-row">
          <DialogHeader>
            <p className="eyebrow">Export</p>
            <DialogTitle>Replay settings</DialogTitle>
            <DialogDescription>
              Preview and Export use these settings for the generated one-file replay
            </DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button
              aria-label="Close export settings"
              className="preview-block__action preview-block__action--icon"
              size="sm"
              variant="ghost"
            >
              <X size={16} strokeWidth={1.8} />
            </Button>
          </DialogClose>
        </div>

        <div className="export-dialog__body">
          <label className="export-option">
            <span>File name</span>
            <Input
              name="filename"
              value={options.filename}
              onChange={updateText}
              placeholder="agent-session-replay"
              disabled={!canExport}
            />
          </label>
          <label className="export-option">
            <span>Export title</span>
            <Input name="title" value={options.title} onChange={updateText} disabled={!canExport} />
          </label>

          <label className="export-option export-option--toggle">
            <span className="export-option__copy">
              <span>Include tool call blocks</span>
              <small>Show structured tool runs in preview and export</small>
            </span>
            <Checkbox
              checked={options.includeToolCalls}
              disabled={!canExport}
              onCheckedChange={(checked) => updateBoolean('includeToolCalls', checked === true)}
            />
          </label>
          <label className="export-option export-option--toggle">
            <span className="export-option__copy">
              <span>Include thinking text</span>
              <small>Keep thinking blocks in the generated replay</small>
            </span>
            <Checkbox
              checked={options.includeThinking}
              disabled={!canExport}
              onCheckedChange={(checked) => updateBoolean('includeThinking', checked === true)}
            />
          </label>
          <label className="export-option export-option--toggle">
            <span className="export-option__copy">
              <span>Reveal thinking in output</span>
              <small>Open thinking blocks by default in the exported replay</small>
            </span>
            <Checkbox
              checked={options.revealThinking}
              disabled={!canExport}
              onCheckedChange={(checked) => updateBoolean('revealThinking', checked === true)}
            />
          </label>
          <label className="export-option export-option--toggle">
            <span className="export-option__copy">
              <span>Keep timestamps</span>
              <small>Preserve turn and session timing metadata in output</small>
            </span>
            <Checkbox
              checked={options.includeTimestamps}
              disabled={!canExport}
              onCheckedChange={(checked) => updateBoolean('includeTimestamps', checked === true)}
            />
          </label>

          <div className="export-dialog__footer">
            <p className="export-footer__hint">
              <FileText size={14} strokeWidth={1.8} />
              Export stays local and read-only in the resulting bundle
            </p>
            {error ? <p className="export-footer__hint">Export error: {error}</p> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { ExportPanel }
