import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BackButton } from './BackButton'

const SRC = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : []
  })
}

describe('BackButton', () => {
  it('is a link with an arrow and the label as its name', () => {
    render(<MemoryRouter><BackButton to="/telefon">Tillbaka till samtalen</BackButton></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Tillbaka till samtalen' })
    expect(link).toHaveAttribute('href', '/telefon')
    expect(link).toHaveClass('btn', 'outline', 'back-btn')
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('is a button that says Tillbaka without a label', async () => {
    const onClick = vi.fn()
    render(<BackButton onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: 'Tillbaka' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

// Tillbaka-kontroller ska alltid vara BackButton, aldrig en textlänk eller en egen knapp.
describe('no plain back controls', () => {
  const files = sourceFiles(SRC).filter((f) => !f.endsWith('BackButton.tsx'))

  it('every "Tillbaka" / "Till alla" text sits in a BackButton', () => {
    const bad: string[] = []
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      // Text på egen rad i JSX (<Link>\n Tillbaka\n</Link>).
      text.split('\n').forEach((line, i) => {
        if (/^\s*(Tillbaka|Till alla|Till utkastet)\b/.test(line)) bad.push(`${relative(SRC, f)}:${i + 1}`)
      })
      // Text direkt efter en tagg: bara <BackButton ...> får ha den.
      for (const m of text.matchAll(/<([A-Za-z.]+)\b[^<>]*>\s*(Tillbaka|Till alla|Till utkastet|Alla [a-zåäö]+\s*<\/(?:Link|a|button|Button)>)/g)) {
        if (m[1] !== 'BackButton') bad.push(`${relative(SRC, f)}: <${m[1]}> ${m[2].trim()}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('the back arrow and old back classes are only used by BackButton', () => {
    const bad: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/name=["']arrow-left["']/.test(line) || (/(?:evenemang|settings)-back\b/.test(line) && !line.includes('<BackButton'))) {
          bad.push(`${relative(SRC, f)}:${i + 1}`)
        }
      })
    }
    expect(bad).toEqual([])
  })
})
