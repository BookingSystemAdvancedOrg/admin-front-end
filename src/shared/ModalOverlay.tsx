import { createPortal } from 'react-dom'
import type { HTMLAttributes, ReactNode } from 'react'

/* Dialogens bakgrund renderas direkt i <body>. Sidans glas (backdrop-filter på
   .admin-main) gör annars att position: fixed räknas från innehållsytan, så
   dialogen hamnade under toppfältet och täckte bara en del av sidan. */
export default function ModalOverlay({ children, className, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return createPortal(
    <div className={className ? `modal-overlay ${className}` : 'modal-overlay'} {...rest}>
      {children}
    </div>,
    document.body,
  )
}
