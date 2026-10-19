/**
 * Vätskan i nyckeltalsrutorna: en enkel men riktig vattenyta.
 *
 * Ytan är en rad kolumner som var och en är en fjäder (Hooke) mot vilonivån,
 * och grannar drar i varandra så att vågor sprider sig och ebbar ut. Det är
 * samma modell som klassiska 2D-vatten i spel. Strålen som häller i trycker
 * ner ytan där den träffar, och stänket är små droppar med tyngdkraft.
 */

export interface Drop {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

export class Liquid {
  /** Avvikelse från vilonivån per kolumn (px, positivt = nedåt). */
  y: Float32Array
  v: Float32Array
  drops: Drop[] = []
  private left: Float32Array
  private right: Float32Array

  readonly columns: number

  constructor(columns: number) {
    this.columns = columns
    this.y = new Float32Array(columns)
    this.v = new Float32Array(columns)
    this.left = new Float32Array(columns)
    this.right = new Float32Array(columns)
  }

  /** Ett tidssteg (~16 ms). */
  step(): void {
    const { y, v, left, right } = this
    const n = y.length
    const tension = 0.022
    const damping = 0.035
    const spread = 0.14

    for (let i = 0; i < n; i++) {
      const a = -tension * y[i] - damping * v[i]
      v[i] += a
      y[i] += v[i]
    }
    // Grannarna jämnar ut sig, några varv per steg så vågen hinner vandra.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n; i++) {
        left[i] = i > 0 ? spread * (y[i] - y[i - 1]) : 0
        right[i] = i < n - 1 ? spread * (y[i] - y[i + 1]) : 0
      }
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          v[i - 1] += left[i]
          y[i - 1] += left[i]
        }
        if (i < n - 1) {
          v[i + 1] += right[i]
          y[i + 1] += right[i]
        }
      }
    }
    // Dropparna faller.
    const g = 0.55
    for (const d of this.drops) {
      d.vy += g
      d.x += d.vx
      d.y += d.vy
    }
  }

  /** Tryck ner (eller upp, negativt) ytan vid en kolumn. */
  push(column: number, force: number): void {
    const i = Math.max(0, Math.min(this.y.length - 1, Math.round(column)))
    this.v[i] += force
  }

  /** Hur mycket rörelse som är kvar; nära noll = ytan ligger stilla. */
  energy(): number {
    let e = 0
    for (let i = 0; i < this.y.length; i++) e += this.y[i] * this.y[i] + this.v[i] * this.v[i]
    return e
  }
}
