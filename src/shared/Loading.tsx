import { useEffect, useRef } from 'react'
import { Liquid } from './motion/liquid'
import { easeOutCubic, reducedMotion } from './motion/countUp'
import './loading.css'

const COLUMNS = 24
const CYCLE = { fill: 1500, hold: 700, drain: 700, pause: 300 }

/**
 * Laddningsindikatorn: ett glas som fylls. En stråle häller i vinrött, ytan
 * gungar (samma vatten som nyckeltalsrutorna), glaset töms och fylls igen
 * tills datan är här. Siffrorna som sedan kommer fyller sina rutor på samma
 * sätt, så väntan och svaret hänger ihop.
 *
 * `inline` är ett litet glas för textrader ("Hämtar…" i ett kort-huvud),
 * `block` (standard) står på egen rad i ett kort, `screen` fyller sidan.
 * Med "minska rörelse" visas ett stilla, halvfullt glas.
 */
export function Loading({
  label = 'Hämtar',
  variant = 'block',
}: {
  label?: string
  variant?: 'inline' | 'block' | 'screen'
}) {
  const text = label.endsWith('…') ? label : `${label}…`
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const host = canvas.parentElement ?? canvas
    const styles = getComputedStyle(host)
    const color = styles.getPropertyValue('--liquid').trim() || '158, 29, 38'
    const edge = styles.getPropertyValue('--liquid-edge').trim() || color
    const glass = styles.getPropertyValue('--glass').trim() || '28, 25, 24'

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const width = canvas.clientWidth || 40
    const height = canvas.clientHeight || 48
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Glasets form: lite smalare nedtill, rundad botten.
    const inset = Math.max(1.5, width * 0.08)
    const topW = width - inset * 2
    const botW = topW * 0.82
    const rim = Math.max(1, height * 0.06)
    const floor = height - inset
    const xAt = (y: number, side: -1 | 1) => {
      const t = Math.min(1, Math.max(0, (y - rim) / (floor - rim)))
      const w = topW + (botW - topW) * t
      return width / 2 + (side * w) / 2
    }
    const glassPath = () => {
      ctx.beginPath()
      ctx.moveTo(xAt(rim, -1), rim)
      ctx.lineTo(xAt(floor, -1), floor - inset * 1.5)
      ctx.quadraticCurveTo(width / 2, floor + inset * 0.8, xAt(floor, 1), floor - inset * 1.5)
      ctx.lineTo(xAt(rim, 1), rim)
    }

    const liquid = new Liquid(COLUMNS)
    const still = reducedMotion()
    const start = performance.now()
    const total = CYCLE.fill + CYCLE.hold + CYCLE.drain + CYCLE.pause
    let raf = 0
    let running = true
    let lastDrop = 0

    const draw = (level: number, pouring: boolean, t: number) => {
      ctx.clearRect(0, 0, width, height)
      const usable = floor - rim - inset
      const surface = floor - inset * 1.2 - level * usable
      const span = xAt(surface, 1) - xAt(surface, -1)

      ctx.save()
      glassPath()
      ctx.closePath()
      ctx.clip()
      // Vätskan, klippt till glaset.
      ctx.beginPath()
      ctx.moveTo(0, height)
      for (let i = 0; i < COLUMNS; i++) {
        ctx.lineTo(xAt(surface, -1) + (i / (COLUMNS - 1)) * span, surface + liquid.y[i])
      }
      ctx.lineTo(width, height)
      ctx.closePath()
      ctx.fillStyle = `rgba(${color}, 0.92)`
      ctx.fill()
      // Ytlinjen.
      ctx.beginPath()
      for (let i = 0; i < COLUMNS; i++) {
        const x = xAt(surface, -1) + (i / (COLUMNS - 1)) * span
        const y = surface + liquid.y[i]
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = `rgba(${edge}, 0.55)`
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()

      // Strålen.
      if (pouring) {
        const x = width / 2 + Math.sin(t / 80) * 0.8
        const w = Math.max(1, width * 0.05)
        ctx.beginPath()
        ctx.moveTo(x - w, 0)
        ctx.lineTo(x + w, 0)
        ctx.lineTo(x + w * 0.5, surface)
        ctx.lineTo(x - w * 0.5, surface)
        ctx.closePath()
        ctx.fillStyle = `rgba(${color}, 0.9)`
        ctx.fill()
      }
      // Stänk.
      ctx.fillStyle = `rgba(${color}, 0.9)`
      for (const d of liquid.drops) {
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
      // Glaset: en tunn kant med en ljus reflex.
      glassPath()
      ctx.strokeStyle = `rgba(${glass}, 0.55)`
      ctx.lineWidth = Math.max(1, width * 0.045)
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(xAt(rim, -1) + inset * 1.6, rim + inset * 2)
      ctx.lineTo(xAt(floor, -1) + inset * 1.8, floor - inset * 3)
      ctx.strokeStyle = `rgba(255, 255, 255, 0.45)`
      ctx.lineWidth = 1
      ctx.stroke()
    }

    if (still) {
      draw(0.55, false, 0)
      return
    }

    const frame = (now: number) => {
      if (!running) return
      const t = (now - start) % total
      let level: number
      let pouring = false
      if (t < CYCLE.fill) {
        level = easeOutCubic(t / CYCLE.fill) * 0.78
        pouring = t < CYCLE.fill * 0.85
      } else if (t < CYCLE.fill + CYCLE.hold) {
        level = 0.78
      } else if (t < CYCLE.fill + CYCLE.hold + CYCLE.drain) {
        const u = (t - CYCLE.fill - CYCLE.hold) / CYCLE.drain
        level = 0.78 * (1 - u * u)
      } else {
        level = 0
      }
      if (pouring) {
        liquid.push((COLUMNS - 1) / 2, 0.5 + Math.random() * 0.4)
        if (now - lastDrop > 110 && Math.random() < 0.5 && width > 24) {
          lastDrop = now
          const usable = floor - rim - inset
          liquid.drops.push({
            x: width / 2 + (Math.random() - 0.5) * 4,
            y: floor - inset * 1.2 - level * usable,
            vx: (Math.random() - 0.5) * 2,
            vy: -(1.5 + Math.random() * 2),
            r: 0.8 + Math.random() * 1,
          })
        }
      }
      liquid.step()
      liquid.drops = liquid.drops.filter((d) => d.vy < 0 || d.y < height)
      draw(level, pouring, now)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      running = false
      if (raf) cancelAnimationFrame(raf)
    }
  }, [variant])

  return (
    <span className={`loading loading--${variant}`} role="status" aria-live="polite">
      <span className="loading-glass" aria-hidden="true">
        <canvas ref={canvasRef} />
      </span>
      <span className="loading-label">{text}</span>
    </span>
  )
}
