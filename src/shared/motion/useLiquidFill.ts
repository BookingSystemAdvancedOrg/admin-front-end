import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { Liquid } from './liquid'
import { easeOutCubic, reducedMotion } from './countUp'

const COLUMNS = 48

export interface LiquidFillOptions {
  /** Kör animationen (false = vänta, t.ex. tills datan kommit). */
  active: boolean
  /** Ordningsnummer: varje ruta börjar lite efter den förra. */
  index?: number
  /** Hur länge påfyllningen tar. */
  fillMs?: number
  /** Fördröjning per ordningsnummer. */
  staggerMs?: number
  /** Var strålen träffar (andel av bredden). */
  pourAt?: number
  /** Kallas varje bildruta med fyllnadsgraden 0..1 (t.ex. för att räkna upp). */
  onProgress?: (progress: number, done: boolean) => void
  /** Utan canvas eller med reducerad rörelse: sätt slutläget direkt. */
  onStatic?: () => void
}

export interface LiquidHandle {
  /** Tryck på ytan vid en x-position (0..1) med en kraft; väcker loopen. */
  touch: (x: number, force: number) => void
}

/**
 * Fyller ett element med vätska (canvas bakom innehållet): en stråle häller
 * från ovan, ytan är riktigt vatten (shared/motion/liquid.ts), stänk med
 * tyngdkraft. Färgen tas från CSS-variablerna --liquid (rgb-tripel) och
 * --liquid-alpha på elementet. Samma effekt för nyckeltalsrutor och
 * sidomenyn.
 */
export function useLiquidFill(
  hostRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { active, index = 0, fillMs = 1500, staggerMs = 140, pourAt = 0.18, onProgress, onStatic }: LiquidFillOptions,
): LiquidHandle {
  const liquidRef = useRef<Liquid | null>(null)
  const wakeRef = useRef<() => void>(() => {})
  const sizeRef = useRef({ width: 1, height: 1 })
  const progressRef = useRef(onProgress)
  const staticRef = useRef(onStatic)
  progressRef.current = onProgress
  staticRef.current = onStatic

  useEffect(() => {
    if (!active) return
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx || reducedMotion()) {
      host.classList.add('liquid--full')
      staticRef.current?.()
      return
    }

    const liquid = new Liquid(COLUMNS)
    liquidRef.current = liquid
    const styles = getComputedStyle(host)
    const color = styles.getPropertyValue('--liquid').trim() || '28, 25, 24'
    const alpha = Number(styles.getPropertyValue('--liquid-alpha')) || 0.1
    // Ytlinje, stråle och stänk: samma färg, eller --liquid-edge där vätskan
    // är helt tät (sidomenyn) och kanten annars inte skulle synas.
    const edge = styles.getPropertyValue('--liquid-edge').trim() || color
    const edgeAlpha = Math.min(1, alpha * 4)

    let width = 0
    let height = 0
    const resize = () => {
      const rect = host.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      width = Math.max(1, Math.round(rect.width))
      height = Math.max(1, Math.round(rect.height))
      sizeRef.current = { width, height }
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
    ro?.observe(host)

    const start = performance.now() + index * staggerMs
    let raf = 0
    let running = true
    let settledFrames = 0
    let lastPour = 0
    let finished = false

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

      // Ytlinjen.
      ctx.beginPath()
      for (let i = 0; i < COLUMNS; i++) {
        const x = i * colW
        const y = surfaceAt(level, i)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = `rgba(${edge}, ${edgeAlpha})`
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Strålen, lite vinglig som en riktig.
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
        ctx.fillStyle = `rgba(${edge}, ${Math.min(1, alpha * 5)})`
        ctx.fill()
      }

      ctx.fillStyle = `rgba(${edge}, ${Math.min(1, alpha * 4.5)})`
      for (const d of liquid.drops) {
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const frame = (now: number) => {
      if (!running) return
      const t = Math.max(0, now - start)
      const progress = easeOutCubic(t / fillMs)
      const pouring = t > 0 && t < fillMs * 0.82
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
      liquid.drops = liquid.drops.filter((d) => {
        const surface = height - level
        if (d.y >= surface + liquid.y[Math.round((d.x / width) * (COLUMNS - 1))] && d.vy > 0) {
          liquid.push((d.x / width) * (COLUMNS - 1), 0.6)
          return false
        }
        return d.y < height + 10 && d.x > -10 && d.x < width + 10
      })

      const done = t >= fillMs
      if (t > 0 && !finished) progressRef.current?.(progress, done)
      if (done) finished = true
      draw(level, pouring, now)

      if (done) {
        if (liquid.energy() < 0.02 && liquid.drops.length === 0) settledFrames++
        else settledFrames = 0
      }
      if (done && settledFrames > 20) {
        draw(height, false, now)
        raf = 0
        return
      }
      raf = requestAnimationFrame(frame)
    }

    progressRef.current?.(0, false)
    raf = requestAnimationFrame(frame)
    wakeRef.current = () => {
      if (!raf && running) raf = requestAnimationFrame(frame)
    }

    return () => {
      running = false
      if (raf) cancelAnimationFrame(raf)
      ro?.disconnect()
      liquidRef.current = null
    }
  }, [active, index, fillMs, staggerMs, pourAt, hostRef, canvasRef])

  return {
    touch: (x, force) => {
      const liquid = liquidRef.current
      if (!liquid) return
      liquid.push(x * (COLUMNS - 1), force)
      wakeRef.current()
    },
  }
}
