import '@testing-library/jest-dom/vitest'

// jsdom har ingen matchMedia. Testerna kör med "minska rörelse": tal och
// rutor visar slutläget direkt, så de kan kontrolleras utan att vänta på
// animationer. Rörelsen i sig testas i shared/motion.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
