/**
 * Den lilla belöningen när något skickas till en skrivare: en bong flyger
 * från chipet till skrivarens kort (finns kortet på skärmen), annars matas
 * en liten bong ut ovanför chipet. Minska rörelse: inget flyger, kortet
 * blinkar bara till. Inga timers att städa: Web Animations tar bort sig själv.
 */

function reduced(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function pulse(target: Element) {
  target.classList.remove('is-receiving')
  // ny ram så att animationen startar om
  void (target as HTMLElement).offsetWidth
  target.classList.add('is-receiving')
  window.setTimeout(() => target.classList.remove('is-receiving'), 900)
}

export function flyToPrinter(from: HTMLElement, stationId: string) {
  if (typeof document === 'undefined' || !/^[a-z0-9]{2,16}$/.test(stationId)) return
  const targets = Array.from(document.querySelectorAll(`[data-stations~="${stationId}"]`))
  if (reduced() || typeof from.animate !== 'function') {
    targets.forEach(pulse)
    return
  }
  const a = from.getBoundingClientRect()
  const ghost = document.createElement('span')
  ghost.className = 'fly-ticket'
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.left = `${a.left + a.width / 2 - 14}px`
  ghost.style.top = `${a.top - 6}px`
  document.body.appendChild(ghost)
  const target = targets.find((t) => {
    const r = t.getBoundingClientRect()
    return r.bottom > 0 && r.top < window.innerHeight
  })
  let anim: Animation
  if (target) {
    const b = target.getBoundingClientRect()
    const dx = b.left + Math.min(48, b.width / 2) - (a.left + a.width / 2)
    const dy = b.top + 24 - a.top
    anim = ghost.animate(
      [
        { transform: 'translate(0, 0) scale(0.6) rotate(0deg)', opacity: 0 },
        { transform: 'translate(0, -18px) scale(1) rotate(-6deg)', opacity: 1, offset: 0.2 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.5) rotate(8deg)`, opacity: 0.2 },
      ],
      { duration: 620, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
    )
    anim.onfinish = () => pulse(target)
  } else {
    anim = ghost.animate(
      [
        { transform: 'translateY(8px) scaleY(0.2)', opacity: 0 },
        { transform: 'translateY(-14px) scaleY(1)', opacity: 1, offset: 0.45 },
        { transform: 'translateY(-26px) scaleY(1)', opacity: 0 },
      ],
      { duration: 560, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    )
  }
  const done = () => ghost.remove()
  anim.addEventListener('finish', done)
  anim.addEventListener('cancel', done)
}
