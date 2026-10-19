import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STORAGE_REGISTRY } from './storageRegistry'

const SRC = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('storage registry', () => {
  it('lists only strictly necessary storage (no consent banner needed)', () => {
    expect(STORAGE_REGISTRY.map((e) => e.category)).toEqual(
      STORAGE_REGISTRY.map(() => 'nödvändig'),
    )
  })

  it('describes every entry fully', () => {
    for (const e of STORAGE_REGISTRY) {
      for (const field of [e.name, e.setBy, e.purpose, e.lifetime]) {
        expect(field.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('every file that writes to browser storage takes its key names from the registry', () => {
    const writers = sourceFiles(SRC).filter((file) => {
      const text = readFileSync(file, 'utf8')
      return /(localStorage|sessionStorage)\.setItem\(|document\.cookie\s*=/.test(text)
    })
    expect(writers.length).toBeGreaterThan(0)
    for (const file of writers) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).toMatch(/from '[./]*(shared\/)?storageRegistry'/)
      expect(text, file).not.toMatch(/document\.cookie\s*=/)
    }
  })

  it('never stores login tokens in web storage', () => {
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/(localStorage|sessionStorage)\.setItem\([^)]*(token|session|auth)/i)
    }
  })
})
