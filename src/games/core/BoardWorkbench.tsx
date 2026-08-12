import { useId, type ReactNode } from 'react'

export interface WorkbenchPanel<TId extends string> {
  id: TId
  label: string
  eyebrow?: string
  content: ReactNode
}

export function BoardWorkbenchTabs<TId extends string>({
  panels,
  active,
  onChange,
  label = '工作台信息面板',
}: {
  panels: readonly WorkbenchPanel<TId>[]
  active: TId
  onChange: (id: TId) => void
  label?: string
}) {
  const baseId = useId()
  return (
    <section className="board-workbench-tabs">
      <div className="board-workbench-tabs__list" role="tablist" aria-label={label}>
        {panels.map((panel) => (
          <button
            key={panel.id}
            id={`${baseId}-tab-${panel.id}`}
            type="button"
            role="tab"
            aria-selected={active === panel.id}
            aria-controls={`${baseId}-panel-${panel.id}`}
            tabIndex={active === panel.id ? 0 : -1}
            onClick={() => onChange(panel.id)}
            onKeyDown={(event) => moveTabFocus(event, panels, panel.id, onChange)}
          >
            <span>{panel.label}</span>
            {panel.eyebrow && <small>{panel.eyebrow}</small>}
          </button>
        ))}
      </div>
      {panels.map((panel) => (
        <div
          key={panel.id}
          id={`${baseId}-panel-${panel.id}`}
          className="board-workbench-tabs__panel"
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${panel.id}`}
          hidden={active !== panel.id}
        >
          {panel.content}
        </div>
      ))}
    </section>
  )
}

function moveTabFocus<TId extends string>(
  event: React.KeyboardEvent<HTMLButtonElement>,
  panels: readonly WorkbenchPanel<TId>[],
  current: TId,
  onChange: (id: TId) => void,
) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = panels.findIndex((panel) => panel.id === current)
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? panels.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + panels.length) % panels.length
  const next = panels[nextIndex]
  if (!next) return
  onChange(next.id)
  requestAnimationFrame(() => {
    document.getElementById(`${event.currentTarget.id.replace(/-tab-.+$/, '')}-tab-${next.id}`)?.focus()
  })
}

