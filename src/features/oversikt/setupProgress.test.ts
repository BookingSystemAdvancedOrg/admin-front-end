import { beforeEach, describe, expect, it } from 'vitest'
import { resetSetupProgress, setupProgress } from './setupProgress'

const list = (...states: (string | null)[]) => states.map((state, i) => ({ id: `s${i}`, state }))

describe('setupProgress', () => {
  beforeEach(() => resetSetupProgress())

  it('has nothing new the first time a place is seen', () => {
    expect(setupProgress('a', list('done', 'open'), 0)).toEqual({ fresh: [], finished: false })
  })

  it('names the steps done since last time', () => {
    setupProgress('a', list('done', 'open', 'open'), 0)
    expect(setupProgress('a', list('done', 'done', 'open'), 5000)).toEqual({ fresh: ['s1'], finished: false })
  })

  it('says when everything just became done (skipped counts as done)', () => {
    setupProgress('a', list('done', 'open', 'skipped'), 0)
    expect(setupProgress('a', list('done', 'done', 'skipped'), 5000)).toEqual({ fresh: ['s1'], finished: true })
  })

  it('repeats the answer for the same list right away (StrictMode), not on a later visit', () => {
    setupProgress('a', list('open'), 0)
    const first = setupProgress('a', list('done'), 5000)
    expect(setupProgress('a', list('done'), 5200)).toBe(first)
    expect(setupProgress('a', list('done'), 9000)).toEqual({ fresh: [], finished: false })
  })

  it('keeps places apart', () => {
    setupProgress('a', list('open'), 0)
    expect(setupProgress('b', list('done'), 5000).fresh).toEqual([])
  })
})
