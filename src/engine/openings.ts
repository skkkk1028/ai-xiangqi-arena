export type RedOpeningFamily = 'central-cannon' | 'xianren-guide' | 'flying-elephant' | 'other'
export type BlackOpeningResponse = 'screen-horses' | 'shun-cannon' | 'other'

export interface OpeningLine {
  id: string
  name: string
  moves: string[]
}

interface BlackResponse {
  kind: BlackOpeningResponse
  weight: number
  name: string
  lines: OpeningLine[]
}

interface RedOpening {
  kind: RedOpeningFamily
  weight: number
  name: string
  responses: BlackResponse[]
}

export interface OpeningSelection {
  id: string
  name: string
  moves: string[]
  redFamily: RedOpeningFamily
  redName: string
  blackResponse: BlackOpeningResponse
  blackName: string
}

// Each prefix is a complete, named four-ply opening line. The black response
// weights are conditional on the red family: Shun Cannon only exists after a
// Central Cannon start, so its 20% weight is redistributed to "other" elsewhere.
const OPENING_BOOK: RedOpening[] = [
  {
    kind: 'central-cannon',
    weight: 50,
    name: '中炮',
    responses: [
      {
        kind: 'screen-horses',
        weight: 50,
        name: '屏风马',
        lines: [
          {
            id: 'central-cannon-screen-horses-right',
            name: '中炮对屏风马',
            moves: ['h2e2', 'h9g7', 'h0g2', 'b9c7'],
          },
          {
            id: 'central-cannon-screen-horses-left',
            name: '中炮对屏风马（镜像）',
            moves: ['b2e2', 'b9c7', 'b0c2', 'h9g7'],
          },
        ],
      },
      {
        kind: 'shun-cannon',
        weight: 20,
        name: '顺炮',
        lines: [
          {
            id: 'central-cannon-shun-cannon-right',
            name: '中炮对顺炮',
            moves: ['h2e2', 'b7e7', 'h0g2', 'h9g7'],
          },
          {
            id: 'central-cannon-shun-cannon-left',
            name: '中炮对顺炮（镜像）',
            moves: ['b2e2', 'h7e7', 'b0c2', 'b9c7'],
          },
        ],
      },
      {
        kind: 'other',
        weight: 30,
        name: '其他稳健应手',
        lines: [
          {
            id: 'central-cannon-other-left-pawn',
            name: '中炮对边卒',
            moves: ['h2e2', 'a6a5', 'b0c2', 'b9c7'],
          },
          {
            id: 'central-cannon-other-right-pawn',
            name: '中炮对边卒（镜像）',
            moves: ['b2e2', 'i6i5', 'h0g2', 'h9g7'],
          },
        ],
      },
    ],
  },
  {
    kind: 'xianren-guide',
    weight: 20,
    name: '仙人指路',
    responses: [
      {
        kind: 'screen-horses',
        weight: 50,
        name: '屏风马',
        lines: [
          {
            id: 'xianren-guide-screen-horses-right',
            name: '仙人指路对屏风马',
            moves: ['e3e4', 'h9g7', 'b0c2', 'b9c7'],
          },
          {
            id: 'xianren-guide-screen-horses-left',
            name: '仙人指路对屏风马（镜像）',
            moves: ['e3e4', 'b9c7', 'h0g2', 'h9g7'],
          },
        ],
      },
      {
        kind: 'other',
        weight: 50,
        name: '其他稳健应手',
        lines: [
          {
            id: 'xianren-guide-other-left-pawn',
            name: '仙人指路对边卒',
            moves: ['e3e4', 'a6a5', 'b0c2', 'b9c7'],
          },
          {
            id: 'xianren-guide-other-right-pawn',
            name: '仙人指路对边卒（镜像）',
            moves: ['e3e4', 'i6i5', 'h0g2', 'h9g7'],
          },
        ],
      },
    ],
  },
  {
    kind: 'flying-elephant',
    weight: 20,
    name: '飞相',
    responses: [
      {
        kind: 'screen-horses',
        weight: 50,
        name: '屏风马',
        lines: [
          {
            id: 'flying-elephant-screen-horses-right',
            name: '飞相对屏风马',
            moves: ['g0e2', 'h9g7', 'h0g2', 'b9c7'],
          },
          {
            id: 'flying-elephant-screen-horses-left',
            name: '飞相对屏风马（镜像）',
            moves: ['c0e2', 'b9c7', 'b0c2', 'h9g7'],
          },
        ],
      },
      {
        kind: 'other',
        weight: 50,
        name: '其他稳健应手',
        lines: [
          {
            id: 'flying-elephant-other-left-pawn',
            name: '飞相对边卒',
            moves: ['g0e2', 'a6a5', 'h0g2', 'b9c7'],
          },
          {
            id: 'flying-elephant-other-right-pawn',
            name: '飞相对边卒（镜像）',
            moves: ['c0e2', 'i6i5', 'b0c2', 'h9g7'],
          },
        ],
      },
    ],
  },
  {
    kind: 'other',
    weight: 10,
    name: '其他开局',
    responses: [
      {
        kind: 'screen-horses',
        weight: 50,
        name: '屏风马',
        lines: [
          {
            id: 'other-screen-horses-right',
            name: '起马对屏风马',
            moves: ['b0c2', 'h9g7', 'h2e2', 'b9c7'],
          },
          {
            id: 'other-screen-horses-left',
            name: '起马对屏风马（镜像）',
            moves: ['h0g2', 'b9c7', 'b2e2', 'h9g7'],
          },
        ],
      },
      {
        kind: 'other',
        weight: 50,
        name: '其他稳健应手',
        lines: [
          {
            id: 'other-other-left-pawn',
            name: '起马对边卒',
            moves: ['b0c2', 'a6a5', 'h2e2', 'b9c7'],
          },
          {
            id: 'other-other-right-pawn',
            name: '起马对边卒（镜像）',
            moves: ['h0g2', 'i6i5', 'b2e2', 'h9g7'],
          },
        ],
      },
    ],
  },
]

export const OPENING_PREFIXES = OPENING_BOOK.flatMap((opening) =>
  opening.responses.flatMap((response) => response.lines.map((line) => [...line.moves])),
)

export function selectOpening(seed: number): OpeningSelection {
  const opening = pickWeighted(OPENING_BOOK, randomUnit(seed, 0))
  const response = pickWeighted(opening.responses, randomUnit(seed, 1))
  const line = response.lines[Math.floor(randomUnit(seed, 2) * response.lines.length)]
  return {
    id: line.id,
    name: line.name,
    moves: [...line.moves],
    redFamily: opening.kind,
    redName: opening.name,
    blackResponse: response.kind,
    blackName: response.name,
  }
}

function pickWeighted<T extends { weight: number }>(entries: T[], unit: number): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
  let cursor = unit * total
  for (const entry of entries) {
    cursor -= entry.weight
    if (cursor < 0) return entry
  }
  return entries[entries.length - 1]
}

function randomUnit(seed: number, stream: number): number {
  let value = (seed ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x85ebca6b) >>> 0
  value ^= value >>> 13
  value = Math.imul(value, 0xc2b2ae35) >>> 0
  value ^= value >>> 16
  return (value >>> 0) / 0x100000000
}
