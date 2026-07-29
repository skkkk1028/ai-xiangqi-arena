import type { ClockState, Color, ResultReason } from './types'

export const TOTAL_TIME_MS = 10 * 60 * 1000
export const TURN_TIME_MS = 60 * 1000
export const RESIGN_SCORE = -1800
export const RESIGN_AFTER_PLIES = 40
export const RESIGN_STREAK = 3
export const NO_CAPTURE_DRAW_PLIES = 120

export function isClockExpired(clocks: ClockState, turn: Color): boolean {
  return clocks[turn] <= 0 || clocks.turn >= TURN_TIME_MS
}

export function updateResignationStreak(
  currentStreak: number,
  historyLength: number,
  score: number,
): number {
  return historyLength >= RESIGN_AFTER_PLIES && score <= RESIGN_SCORE
    ? currentStreak + 1
    : 0
}

export function getSimplifiedDrawReason(
  repetitionCount: number,
  noCapturePlies: number,
): ResultReason | null {
  if (repetitionCount >= 3) return 'repetition'
  if (noCapturePlies >= NO_CAPTURE_DRAW_PLIES) return 'no-capture'
  return null
}
