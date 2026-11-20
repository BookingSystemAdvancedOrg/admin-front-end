import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { setOrigin } from './motion/origin'
import type { HTMLAttributes, ReactNode } from 'react'

/* Dialogens bakgrund renderas direkt i <body>. Sidans glas (backdrop-filter på
   .admin-main) gör annars att position: fixed räknas från innehållsytan, så
   dialogen hamnade under toppfältet och täckte bara en del av sidan. */
export default function ModalOverlay({ children, className, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  // Öppnas den ovanpå en <dialog> (Modal i @booqy/brand) är resten av sidan inert;
  // då behöver den ett eget översta lager för att gå att klicka i.
  const [onTop] = useState(modalDialogOpen)
  // Panelen växer ur raden eller knappen man tryckte på (motion.css); stängs direkt.
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const panel = box.current?.firstElementChild
    if (panel instanceof HTMLElement) setOrigin(panel)
  }, [])
  const overlay = (
    <div ref={box} className={className ? `modal-overlay ${className}` : 'modal-overlay'} {...rest}>
      {children}
    </div>
  )
  return createPortal(onTop ? <TopLayer>{overlay}</TopLayer> : overlay, document.body)
}

function modalDialogOpen(): boolean {
  try {
    return document.querySelector('dialog:modal') !== null
  } catch {
    return false
  }
}

function TopLayer({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open && typeof d.showModal === 'function') d.showModal()
    return () => d?.close()
  }, [])
  // Escape hanteras av innehållet (ConfirmDialog m.fl.), inte av webbläsaren.
  return (
    <dialog ref={ref} className="modal-layer" onCancel={(e) => e.preventDefault()}>
      {children}
    </dialog>
  )
}
