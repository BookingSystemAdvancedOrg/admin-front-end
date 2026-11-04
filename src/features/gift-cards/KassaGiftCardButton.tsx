import { useState } from 'react'
import { Bar, Button, Field, Input, Modal, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { kassaGiftCardsAvailable, markKassaRefused } from './kassaAvailability'
import { ERRORS, addKassaGiftCardPayment, kr, lookupCode, newTxId, redeemCode, reverseRedemption } from './api'

function isNotSupported(err: unknown): boolean {
  const e = err as { status?: number; code?: string; body?: { code?: string } } | null
  return e?.status === 501 || e?.code === 'gift_card_receipt_not_supported' || e?.body?.code === 'gift_card_receipt_not_supported'
}

/** Kassan > betala > "Presentkort": koden, saldot och beloppet, sedan en betalning på notan. */
export default function KassaGiftCardButton(props: {
  locationId: string; billId: string; remainingOre: number; onPaid: (p: { paymentId: string; amountOre: number }) => void
  /** Tests only: render even while Kassa refuses gift cards. */
  forceAvailable?: boolean
}) {
  const [hidden, setHidden] = useState(!(props.forceAvailable || kassaGiftCardsAvailable()))
  if (hidden) return null
  return <KassaGiftCardDialog {...props} onRefused={() => { markKassaRefused(); setHidden(true) }} />
}

function KassaGiftCardDialog({ locationId, billId, remainingOre, onPaid, onRefused }: {
  locationId: string; billId: string; remainingOre: number; onPaid: (p: { paymentId: string; amountOre: number }) => void
  onRefused: () => void
}) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [found, setFound] = useState<{ balanceOre: number; last4: string; status: string } | null>(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  function close() {
    setOpen(false)
    setCode('')
    setFound(null)
    setAmount('')
  }

  async function check() {
    setBusy(true)
    try {
      const card = await lookupCode(locationId, code)
      setFound(card)
      setAmount(String(Math.min(card.balanceOre, remainingOre) / 100))
    } catch (err) {
      toast(errorText(err, 'Koden finns inte.', { not_found: 'Koden finns inte. Kontrollera den och försök igen.', ...ERRORS }), { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  async function pay() {
    const amountOre = Math.round(Number(amount.replace(',', '.')) * 100)
    if (!found || !Number.isFinite(amountOre) || amountOre <= 0) return
    setBusy(true)
    const txId = newTxId()
    try {
      await redeemCode(locationId, { txId, code, amountOre, billId })
      try {
        await addKassaGiftCardPayment(locationId, billId, txId)
      } catch (err) {
        await reverseRedemption(locationId, txId).catch(() => undefined)
        if (isNotSupported(err)) {
          toast(ERRORS.gift_card_receipt_not_supported, { tone: 'danger' })
          close()
          onRefused()
          return
        }
        throw err
      }
      toast(`Presentkort ****${found.last4}: ${kr(amountOre)} betalt.`, { tone: 'success' })
      close()
      onPaid({ paymentId: txId, amountOre })
    } catch (err) {
      toast(errorText(err, 'Det gick inte att betala med presentkortet.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const tooMuch = found ? Math.round(Number(amount.replace(',', '.')) * 100) > Math.min(found.balanceOre, remainingOre) : false
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={remainingOre <= 0}>Presentkort</Button>
      <Modal open={open} title="Betala med presentkort" onClose={close}
        footer={
          <Bar variant="action" label="Presentkort">
            <Button variant="ghost" onClick={close}>Avbryt</Button>
            {found ? (
              <Button busy={busy} busyLabel="Betalar…" disabled={tooMuch || found.status !== 'active'} onClick={() => void pay()}>Ta betalt</Button>
            ) : (
              <Button busy={busy} busyLabel="Kollar…" disabled={code.replace(/[\s-]/g, '').length !== 16} onClick={() => void check()}>Kolla saldo</Button>
            )}
          </Bar>
        }>
        <Field label="Kod" hint="16 tecken, till exempel ABCD-EFGH-JKMN-PQRS." required>
          <Input value={code} autoComplete="off" onChange={(e) => { setCode(e.target.value.toUpperCase()); setFound(null) }} />
        </Field>
        {found ? (
          <>
            <p>Saldo: <strong>{kr(found.balanceOre)}</strong>{found.status !== 'active' ? ' (kan inte användas)' : ''}</p>
            <Field label="Belopp (kr)" hint={`Högst ${kr(Math.min(found.balanceOre, remainingOre))}.`} required>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </>
        ) : null}
      </Modal>
    </>
  )
}
