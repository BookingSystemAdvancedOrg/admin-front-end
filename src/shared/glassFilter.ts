/**
 * Brytande glas, samma som booqy.se och Booqy Console: på Chromium böjer
 * SVG-filtret "booqy-glass" det som ligger bakom en glasyta (förskjutning
 * styrd av brus), ovanpå en lätt oskärpa. Det läggs till en gång, med samma
 * värden som booqy.se, och <html> får .glass-refract så att CSS kan använda
 * det. Andra webbläsare ignorerar url() i backdrop-filter och behåller den
 * vanliga frostade oskärpan från CSS:en.
 */
export function installGlassFilter() {
  if (typeof document === 'undefined' || document.getElementById('booqy-glass')) return
  if (!window.CSS?.supports?.('backdrop-filter', 'url(#x) blur(1px)') || !/Chrome\//.test(navigator.userAgent)) return
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.position = 'absolute'
  svg.innerHTML =
    '<filter id="booqy-glass" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="2" seed="3" result="noise"/>' +
    '<feGaussianBlur in="noise" stdDeviation="2" result="soft"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="soft" scale="24" xChannelSelector="R" yChannelSelector="G"/></filter>'
  document.body.appendChild(svg)
  document.documentElement.classList.add('glass-refract')
}
