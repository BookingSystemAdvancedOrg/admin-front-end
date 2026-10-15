import { useId } from 'react'

/**
 * Admin-appens egen ikon: ett runt bord sett ovanifrån med fyra stolar och
 * en bock - "bokningen är klar". Samma bild som public/favicon.svg och
 * apple-touch-icon.png. Dekorativ (aria-hidden); namnet står bredvid.
 */
export function BrandMark({ size = 34 }: { size?: number }) {
  const gradient = `booqy-bg-${useId().replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a96ff" />
          <stop offset="1" stopColor="#0062e0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14.5" fill={`url(#${gradient})`} />
      <g fill="#fff" fillOpacity="0.92">
        <rect x="25" y="8.5" width="14" height="6.5" rx="3.25" />
        <rect x="25" y="49" width="14" height="6.5" rx="3.25" />
        <rect x="8.5" y="25" width="6.5" height="14" rx="3.25" />
        <rect x="49" y="25" width="6.5" height="14" rx="3.25" />
      </g>
      <circle cx="32" cy="32" r="14" fill="#fff" />
      <path
        d="M25.5 32.6l4.3 4.3 8.7-9.6"
        fill="none"
        stroke="#0a6cf0"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
