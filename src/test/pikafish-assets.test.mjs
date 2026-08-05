import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('固定 Pikafish 发行资产', () => {
  it.each([
    ['pikafish.wasm', '1233b07cbc741faac3e8251f91b8c74b048938a62bd3a01535bfd1d8b3907e12'],
    ['../../engine-assets/pikafish.nnue', 'c4026370d7516d9b0f668447f9ca1931241538bdc689cde6fec6a991ac4d5f77'],
    ['pikafish-2025.js', '79c05ed94c56ec4e4607afaf0bcca9807bf07240c19c69b6b94408def9990a8b'],
    ['pikafish-2025.wasm', 'f69321101d5dc8f8228f1ddc51abee0838f5f59d632fe4672623cc41538d282c'],
    ['../../engine-assets/pikafish-2025.nnue', '9b2ce59b760c26f284b9fcadd091fa789d9fd4e8c1dd71ffbd42212503a13e95'],
  ])('%s 的 SHA-256 与配置记录一致', (name, expected) => {
    const path = name.startsWith('../')
      ? resolve(process.cwd(), 'src', 'test', name)
      : resolve(process.cwd(), 'public', 'engine', name)
    const bytes = readFileSync(path)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected)
  })
})
