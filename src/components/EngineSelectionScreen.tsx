import { useMemo, useState } from 'react'
import type { AIEngineConfig } from '../engine/types'
import type { EngineState } from '../hooks/useAiMatch'
import { ChevronLeftIcon, PlayIcon } from './Icons'

interface EngineSelectionScreenProps {
  engines: ReadonlyArray<Readonly<AIEngineConfig>>
  engineStates: Record<'red' | 'black', EngineState>
  onBack: () => void
  onStart: (redId: string, blackId: string) => Promise<void>
}

export function EngineSelectionScreen({
  engines,
  engineStates,
  onBack,
  onStart,
}: EngineSelectionScreenProps) {
  const [redId, setRedId] = useState(engines[0]?.id ?? '')
  const [blackId, setBlackId] = useState(engines[1]?.id ?? engines[0]?.id ?? '')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const red = useMemo(() => engines.find((engine) => engine.id === redId), [engines, redId])
  const black = useMemo(() => engines.find((engine) => engine.id === blackId), [blackId, engines])
  const invalid = !red || !black || red.id === black.id

  const start = async () => {
    if (invalid || starting) return
    setStarting(true)
    setError(null)
    try {
      await onStart(redId, blackId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setStarting(false)
    }
  }

  return (
    <main className="engine-selection-page">
      <header className="selection-header">
        <button className="back-button" onClick={onBack} aria-label="返回首页" disabled={starting}>
          <ChevronLeftIcon />
        </button>
        <div>
          <p className="eyebrow">ENGINE BATTLE</p>
          <h1>AI 引擎对战</h1>
          <p>双方使用独立 Worker、独立引擎配置与相同设备资源上限。</p>
        </div>
      </header>

      <section className="engine-versus-grid">
        <EnginePicker
          color="red"
          value={redId}
          engines={engines}
          selected={red}
          state={engineStates.red}
          disabled={starting}
          onChange={setRedId}
        />
        <div className="versus-mark" aria-label="对阵">VS</div>
        <EnginePicker
          color="black"
          value={blackId}
          engines={engines}
          selected={black}
          state={engineStates.black}
          disabled={starting}
          onChange={setBlackId}
        />
      </section>

      <div className="selection-rules">
        <span>不降低 Skill</span>
        <span>独立 NNUE 校验</span>
        <span>相同棋钟规则</span>
        <span>合法着法二次检查</span>
      </div>
      {invalid && <p className="selection-error">请选择两个不同引擎或不同核心配置。</p>}
      {error && <p className="selection-error" role="alert">{error}</p>}
      <button className="start-button selection-start" onClick={() => void start()} disabled={invalid || starting}>
        <span>{starting ? '正在独立初始化双方引擎' : '开始引擎对战'}</span>
        {!starting && <PlayIcon />}
      </button>
    </main>
  )
}

interface EnginePickerProps {
  color: 'red' | 'black'
  value: string
  engines: ReadonlyArray<Readonly<AIEngineConfig>>
  selected?: Readonly<AIEngineConfig>
  state: EngineState
  disabled: boolean
  onChange: (id: string) => void
}

function EnginePicker({ color, value, engines, selected, state, disabled, onChange }: EnginePickerProps) {
  return (
    <article className={`engine-picker engine-picker--${color}`}>
      <span className="side-seal">{color === 'red' ? '红' : '黑'}</span>
      <label htmlFor={`${color}-engine`}>{color === 'red' ? '红方 AI' : '黑方 AI'}</label>
      <select
        id={`${color}-engine`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {engines.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}
      </select>
      {selected && (
        <dl>
          <div><dt>协议</dt><dd>{selected.protocol}</dd></div>
          <div><dt>引擎类型</dt><dd>{selected.engineType}</dd></div>
          <div><dt>核心</dt><dd>{selected.version}</dd></div>
          <div><dt>Skill</dt><dd>{selected.skillLevel ?? '满强度（无 Skill 限制）'}</dd></div>
          <div><dt>线程 / Hash</dt><dd>{selected.threads} / {selected.hash} MB（启动时按设备公平上调）</dd></div>
          <div><dt>NNUE</dt><dd>{selected.nnuePath}</dd></div>
        </dl>
      )}
      {disabled && (
        <div className="picker-progress" aria-live="polite">
          <span className={`pulse-dot ${state.phase === 'error' ? 'has-error' : ''}`} />
          {state.progress?.message ?? (state.phase === 'ready' ? '已就绪' : '等待初始化')}
        </div>
      )}
    </article>
  )
}
