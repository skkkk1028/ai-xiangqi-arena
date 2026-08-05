import { useState } from 'react'
import { DIFFICULTY_PROFILES, type DifficultyLevel } from '../engine/difficulty'
import type { AIEngineConfig } from '../engine/types'
import type { HumanColorChoice, HumanEngineState } from '../hooks/useHumanVsEngine'
import { ChevronLeftIcon, PlayIcon } from './Icons'

interface HumanVsEngineConfigScreenProps {
  engines: ReadonlyArray<Readonly<AIEngineConfig>>
  engineState: HumanEngineState
  onBack: () => void
  onStart: (color: HumanColorChoice, engineId: string, difficulty: DifficultyLevel) => Promise<void>
}

export function HumanVsEngineConfigScreen({
  engines,
  engineState,
  onBack,
  onStart,
}: HumanVsEngineConfigScreenProps) {
  const [color, setColor] = useState<HumanColorChoice>('red')
  const [engineId, setEngineId] = useState(engines[0]?.id ?? '')
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(3)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedEngine = engines.find((engine) => engine.id === engineId)
  const selectedDifficulty = DIFFICULTY_PROFILES[difficulty]

  const start = async () => {
    if (!engineId || starting) return
    setStarting(true)
    setError(null)
    try {
      await onStart(color, engineId, difficulty)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setStarting(false)
    }
  }

  return (
    <main className="engine-selection-page human-config-page">
      <header className="selection-header">
        <button className="back-button" onClick={onBack} aria-label="返回首页" disabled={starting}>
          <ChevronLeftIcon />
        </button>
        <div>
          <p className="eyebrow">HUMAN VS ENGINE</p>
          <h1>真人挑战 AI</h1>
          <p>选择执子颜色、已注册引擎与统一难度。真人不限时，AI 按难度控制本步搜索。</p>
        </div>
      </header>

      <section className="human-config-grid">
        <fieldset className="config-panel">
          <legend>真人执子</legend>
          <div className="segmented-options">
            {([
              ['red', '红方 · 先手'],
              ['black', '黑方 · 后手'],
              ['random', '随机'],
            ] as const).map(([value, label]) => (
              <label key={value} className={color === value ? 'is-selected' : ''}>
                <input
                  type="radio"
                  name="human-color"
                  value={value}
                  checked={color === value}
                  disabled={starting}
                  onChange={() => setColor(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="config-panel">
          <legend>AI 引擎</legend>
          <label className="select-label" htmlFor="human-engine">Engine Registry</label>
          <select
            id="human-engine"
            value={engineId}
            disabled={starting}
            onChange={(event) => setEngineId(event.target.value)}
          >
            {engines.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}
          </select>
          {selectedEngine && (
            <p className="config-detail">
              {selectedEngine.protocol} · {selectedEngine.version}<br />
              {selectedEngine.styleDescription}
            </p>
          )}
        </fieldset>

        <fieldset className="config-panel config-panel--difficulty">
          <legend>AI 难度</legend>
          <div className="difficulty-options">
            {(Object.values(DIFFICULTY_PROFILES)).map((profile) => (
              <label key={profile.level} className={difficulty === profile.level ? 'is-selected' : ''}>
                <input
                  type="radio"
                  name="difficulty"
                  value={profile.level}
                  checked={difficulty === profile.level}
                  disabled={starting}
                  onChange={() => setDifficulty(profile.level)}
                />
                <strong>等级 {profile.level}</strong>
                <span>{profile.name}</span>
                <small>{profile.minThinkMs / 1000}–{profile.maxThinkMs / 1000} 秒</small>
              </label>
            ))}
          </div>
          <p className="difficulty-summary">{selectedDifficulty.description}</p>
        </fieldset>
      </section>

      {starting && (
        <p className="human-loading" aria-live="polite">
          {engineState.progress?.message ?? '正在按所选难度初始化 AI Worker…'}
        </p>
      )}
      {error && <p className="selection-error" role="alert">{error}</p>}
      <button className="start-button selection-start" onClick={() => void start()} disabled={starting || !engineId}>
        <span>{starting ? '正在准备人机对局' : '开始人机对战'}</span>
        {!starting && <PlayIcon />}
      </button>
    </main>
  )
}
