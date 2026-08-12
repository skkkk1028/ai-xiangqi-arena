import { goMoveToGtp, gtpToGoMove } from '../../src/games/go/ai/coordinates'

export interface CalibrationOpening {
  id: string
  familyId: string
  transform: 'identity' | 'rotate-90' | 'rotate-180' | 'rotate-270'
  moves: readonly string[]
}

const BASE_OPENINGS: readonly (readonly string[])[] = [
  ['D16', 'Q4', 'Q16', 'D4'],
  ['D16', 'Q4', 'C4', 'Q16'],
  ['D16', 'Q4', 'Q3', 'C17'],
  ['D16', 'Q4', 'C3', 'R16'],
  ['D16', 'Q4', 'D4', 'Q16', 'C6', 'R14'],
  ['D16', 'Q4', 'Q16', 'D4', 'R14', 'C6'],
  ['D16', 'Q4', 'C4', 'D6', 'Q16', 'R14'],
  ['D16', 'Q4', 'Q3', 'R5', 'C17', 'D14'],
  ['D16', 'Q4', 'F17', 'D4', 'Q16', 'R14'],
  ['D16', 'Q4', 'C14', 'Q16', 'D4', 'R6'],
  ['D16', 'Q4', 'Q16', 'C3', 'D4', 'R17'],
  ['D16', 'Q4', 'E17', 'D4', 'Q16', 'P17'],
  ['D16', 'Q4', 'Q16', 'D4', 'C10', 'Q10'],
]

const transforms = [
  { name: 'identity', apply: (row: number, col: number) => ({ row, col }) },
  { name: 'rotate-90', apply: (row: number, col: number) => ({ row: col, col: 18 - row }) },
  { name: 'rotate-180', apply: (row: number, col: number) => ({ row: 18 - row, col: 18 - col }) },
  { name: 'rotate-270', apply: (row: number, col: number) => ({ row: 18 - col, col: row }) },
] as const

export const GO_CALIBRATION_OPENINGS: readonly CalibrationOpening[] = transforms
  .flatMap((transform) => BASE_OPENINGS.map((moves, familyIndex) => ({
    familyId: `F${String(familyIndex + 1).padStart(2, '0')}`,
    transform: transform.name,
    moves: moves.map((vertex) => {
      const move = gtpToGoMove(vertex)
      if ('kind' in move && move.kind === 'pass') throw new Error('校准开局不得包含虚着。')
      return goMoveToGtp(transform.apply(move.row, move.col))
    }),
  })))
  .slice(0, 50)
  .map((opening, index) => ({ id: `O${String(index + 1).padStart(2, '0')}`, ...opening }))
