// Twenty-four deliberately short, symmetric opening prefixes. Every move is
// still checked against the local rules engine before it is played.
const RED_FIRST = ['b0c2', 'h0g2', 'b2e2', 'h2e2', 'c3c4', 'g3g4']
const BLACK_FIRST = ['b9c7', 'h9g7', 'b7e7', 'h7e7']

export const OPENING_PREFIXES = RED_FIRST.flatMap((red) =>
  BLACK_FIRST.map((black) => [red, black]),
)

export function selectOpening(seed: number): string[] {
  return [...OPENING_PREFIXES[seed % OPENING_PREFIXES.length]]
}
