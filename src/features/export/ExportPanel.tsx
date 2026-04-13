import { Download, FileText, Settings } from 'lucide-react'
import { type ChangeEvent } from 'react'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'

export type ExportOptions = {
  filename: string
  title: string
  includeToolCalls: boolean
  includeThinking: boolean
  revealThinking: boolean
  includeTimestamps: boolean
}

export type ExportPanelProps = {
  options: ExportOptions
  canExport: boolean
  isExporting: boolean
  onOptionChange: (next: ExportOptions) => void
  onExport: () => void
}

function ExportPanel({ options, canExport, isExporting, onOptionChange, onExport }: ExportPanelProps) {
  const updateText = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target
    onOptionChange({ ...options, [name]: value })
  }

  const updateBoolean = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = event.target
    onOptionChange({ ...options, [name]: checked })
  }

  return (
    <Card className="export-card">
      <div className="card__header">
        <h3>Export settings</h3>
      </div>
      <div className="card__content">
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
          <span>Include tool call blocks</span>
          <input
            name="includeToolCalls"
            type="checkbox"
            checked={options.includeToolCalls}
            onChange={updateBoolean}
            disabled={!canExport}
          />
        </label>
        <label className="export-option export-option--toggle">
          <span>Include thinking text</span>
          <input
            name="includeThinking"
            type="checkbox"
            checked={options.includeThinking}
            onChange={updateBoolean}
            disabled={!canExport}
          />
        </label>
        <label className="export-option export-option--toggle">
          <span>Reveal thinking in output</span>
          <input
            name="revealThinking"
            type="checkbox"
            checked={options.revealThinking}
            onChange={updateBoolean}
            disabled={!canExport}
          />
        </label>
        <label className="export-option export-option--toggle">
          <span>Keep timestamps</span>
          <input
            name="includeTimestamps"
            type="checkbox"
            checked={options.includeTimestamps}
            onChange={updateBoolean}
            disabled={!canExport}
          />
        </label>
      </div>
      <div className="card__footer export-footer">
        <Button
          className="export-button"
          onClick={onExport}
          disabled={!canExport || isExporting}
        >
          <Download size={14} strokeWidth={1.8} />
          {isExporting ? 'Generating export...' : 'Generate one-file html'}
        </Button>
        <p className="export-footer__hint">
          <FileText size={14} strokeWidth={1.8} />
          Export stays local and read-only in the resulting bundle
        </p>
        <p className="export-footer__hint">
          <Settings size={14} strokeWidth={1.8} />
          Viewer options are applied from adapter state at export time
        </p>
      </div>
    </Card>
  )
}

export { ExportPanel }
