import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Liquid } from './liquid'
import { easeOutCubic, formatStatValue, parseStatValue } from './countUp'

const FILL_MS = 1500
const STAGGER_MS = 140
const COLUMNS = 48

/**
 * Nyckeltalsruta som fylls med vätska när siffran kommer: strålen häller i
 * från ovan, ytan gungar, siffran räknar upp i takt med nivån. Texten ligger
 * ovanpå vätskan och är alltid läsbar. Med "minska rörelse" i systemet visas
 * slutläget direkt.
 */
export function StatTile({
  label,
  value,
  note,
  action,
  to,
  tone,
  loading,
  index,
}: {
  label: string
  value: string
  note: string
  action: string
  to: string
  tone?: 'attention'
  loading: boolean
  index: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const valueRef = useRef<HTMLParagraphElement>(null)
  const tileRef = useRef<HTMLAnchorElement>(null)
  const liquidRef = useRef<Liquid | null>(null)
  const wakeRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (loading) return
    const canvas = canvasRef.current
    const tile = tileRef.current
    const valueEl = valueRef.current
    if (!canvas || !tile || !valueEl) return
    const ctx = canvas.getContext('2d')
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!ctx || reduce) {
      tile.classList.add('stat-tile--full')
      return
    }

    const liquid = new Liquid(COLUMNS)
    liquidRef.current = liquid
    const number = parseStatValue(value)
    const styles = getComputedStyle(tile)
    const color = styles.getPropertyValue('--liquid').trim() || '28, 25, 24'
    const alpha = Number(styles.getPropertyValue('--liquid-alpha')) || 0.1
    const pourAt = 0.18 // var strålen träffar (andel av bredden)

    let width = 0
    let height = 0
    let dpr = 1
    const resize = () => {
      const rect = tile.getBoundingClientRect()
      dpr = Math.min(2, window.devicePixelRatio || 1)
      width = Math.max(1, Math.round(rect.width))
      height = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
    ro?.observe(tile)

    const start = performance.now() + index * STAGGER_MS
    let raf = 0
    let running = true
    let settledFrames = 0
    let lastPour = 0

    const surfaceAt = (level: number, i: number) => height - level + liquid.y[i]

    const draw = (level: number, pouring: boolean, t: number) => {
      ctx.clearRect(0, 0, width, height)
      const colW = width / (COLUMNS - 1)

      // Bakre lager, lite fasförskjutet: ger djup åt ytan.
      ctx.beginPath()
      ctx.moveTo(0, height)
      for (let i = 0; i < COLUMNS; i++) {
        const j = Math.min(COLUMNS - 1, i + 3)
        ctx.lineTo(i * colW, height - level + liquid.y[j] * 0.7 - 3)
      }
      ctx.lineTo(width, height)
      ctx.closePath()
      ctx.fillStyle = `rgba(${color}, ${alpha * 0.55})`
      ctx.fill()

      // Vätskan.
      ctx.beginPath()
      ctx.moveTo(0, height)
      for (let i = 0; i < COLUMNS; i++) ctx.lineTo(i * colW, surfaceAt(level, i))
      ctx.lineTo(width, height)
      ctx.closePath()
      ctx.fillStyle = `rgba(${color}, ${alpha})`
      ctx.fill()

      // Ytlinjen: en tunn ljus kant där vätskan möter luften.
      ctx.beginPath()
      for (let i = 0; i < COLUMNS; i++) {
        const x = i * colW
        const y = surfaceAt(level, i)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = `rgba(${color}, ${Math.min(1, alpha * 4)})`
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Strålen som häller i, lite vinglig som en riktig.
      if (pouring) {
        const x = width * pourAt + Math.sin(t / 90) * 1.2
        const hit = surfaceAt(level, Math.round(pourAt * (COLUMNS - 1)))
        const w = 3 + Math.sin(t / 140) * 0.6
        ctx.beginPath()
        ctx.moveTo(x - w, 0)
        ctx.quadraticCurveTo(x - w * 0.6, hit * 0.5, x - w * 0.45, hit)
        ctx.lineTo(x + w * 0.45, hit)
        ctx.quadraticCurveTo(x + w * 0.6, hit * 0.5, x + w, 0)
        ctx.closePath()
        ctx.fillStyle = `rgba(${color}, ${Math.min(1, alpha * 5)})`
        ctx.fill()
      }

      // Stänk.
      ctx.fillStyle = `rgba(${color}, ${Math.min(1, alpha * 4.5)})`
      for (const d of liquid.drops) {
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const frame = (now: number) => {
      if (!running) return
      const t = Math.max(0, now - start)
      const progress = easeOutCubic(t / FILL_MS)
      const pouring = t > 0 && t < FILL_MS * 0.82
      const level = progress * height

      if (pouring) {
        const col = pourAt * (COLUMNS - 1)
        liquid.push(col, 0.9 + Math.random() * 0.5)
        if (now - lastPour > 70 && Math.random() < 0.6) {
          lastPour = now
          liquid.drops.push({
            x: width * pourAt + (Math.random() - 0.5) * 6,
            y: height - level,
            vx: (Math.random() - 0.5) * 3.2,
            vy: -(2.5 + Math.random() * 3),
            r: 1 + Math.random() * 1.6,
          })
        }
      }
      liquid.step()
      // Droppar som landat försvinner i vätskan och sätter ett litet avtryck.
      liquid.drops = liquid.drops.filter((d) => {
        const surface = height - level
        if (d.y >= surface + liquid.y[Math.round((d.x / width) * (COLUMNS - 1))] && d.vy > 0) {
          liquid.push((d.x / width) * (COLUMNS - 1), 0.6)
          return false
        }
        return d.y < height + 10 && d.x > -10 && d.x < width + 10
      })

      if (number && t > 0) {
        valueEl.textContent = formatStatValue(number, number.value * progress)
      }

      draw(level, pouring, now)

      const done = t >= FILL_MS
      if (done) {
        if (number) valueEl.textContent = value
        if (liquid.energy() < 0.02 && liquid.drops.length === 0) settledFrames++
        else settledFrames = 0
      }
      if (done && settledFrames > 20) {
        // Stilla: rita slutläget och sluta spendera bildrutor.
        draw(height, false, now)
        raf = 0
        return
      }
      raf = requestAnimationFrame(frame)
    }

    // Startläge innan strålen börjat: tomt kärl och nollan.
    if (number) valueEl.textContent = formatStatValue(number, 0)
    raf = requestAnimationFrame(frame)

    // Pekaren rör vid ytan: en liten våg där den går in, och loopen vaknar.
    wakeRef.current = () => {
      if (!raf && running) raf = requestAnimationFrame(frame)
    }

    return () => {
      running = false
      if (raf) cancelAnimationFrame(raf)
      ro?.disconnect()
      liquidRef.current = null
    }
  }, [loading, value, index])

  const touch = (e: React.PointerEvent<HTMLAnchorElement>, force: number) => {
    const liquid = liquidRef.current
    const tile = tileRef.current
    if (!liquid || !tile) return
    const rect = tile.getBoundingClientRect()
    const col = ((e.clientX - rect.left) / rect.width) * (COLUMNS - 1)
    liquid.push(col, force)
    wakeRef.current()
  }

  return (
    <Link
      ref={tileRef}
      to={to}
      className={`admin-card stat-tile stat-tile--link${tone ? ` stat-tile--${tone}` : ''}`}
      onPointerEnter={(e) => touch(e, 3.5)}
      onPointerMove={(e) => {
        if (Math.random() < 0.25) touch(e, 0.35)
      }}
      onPointerLeave={(e) => touch(e, -2)}
    >
      <canvas ref={canvasRef} className="stat-tile-liquid" aria-hidden="true" />
      <p className="stat-tile-label">{label}</p>
      <p ref={valueRef} className="stat-tile-value">
        {loading ? '…' : value}
      </p>
      <p className="stat-tile-note">{loading ? 'Hämtar…' : note}</p>
      <span className="stat-tile-action">
        {action} <span aria-hidden="true">→</span>
      </span>
    </Link>
  )
}
