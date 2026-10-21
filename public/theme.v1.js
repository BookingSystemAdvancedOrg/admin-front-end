/* Ljust eller mörkt läge, satt innan sidan ritas så att inget blinkar.
   Valet ligger i localStorage under "booqy-theme" (src/shared/theme.ts
   och storageRegistry.ts). Utan val är admin ljust. Vanligt, blockerande
   skript (inte module) så att det hinner före första bildrutan; får ligga
   inline-fritt eftersom CloudFronts CSP bara tillåter script-src 'self'.
   Filen cachas i ett år under sitt namn: ändras den, höj versionen i
   filnamnet och i index.html. */
;(function (root) {
  var theme = null
  try {
    theme = localStorage.getItem('booqy-theme')
  } catch {
    /* privat läge utan lagring */
  }
  if (theme !== 'light' && theme !== 'dark') theme = 'light'
  root.setAttribute('data-theme', theme)
  // Webbläsarens egen ram (meta theme-color) följer skrivbordet.
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#1c1918' : '#f1eee6')
})(document.documentElement)
