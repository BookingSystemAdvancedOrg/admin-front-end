import { useState } from 'react'
import { Bar } from '@booqy/brand'
import { ErrorNote } from '../../shared/ErrorNote'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { Loading } from '../../shared/Loading'
import { booqyFaultText } from '../../shared/errors'
import { CALL_TEXT_VIEW_KEY_PREFIX } from '../../shared/storageRegistry'
import type { Turn } from './api'
import { VIEWS, isView, langChip, readView, shownText, translationState, type TextView } from './transcriptText'

const ROLE: Record<string, string> = { agent: 'Assistenten', caller: 'Den som ringde', tool: 'Bokningssystemet', system: 'System' }

/**
 * Utskriften på samtalssidan. Original, Svenska eller English (svenska
 * först; valet sparas per användare). Översättningen görs efter samtalet:
 * medan den pågår eller om den misslyckades visas originalet. Servern
 * försöker själv igen; Försök igen i felrutan hämtar bara om sidan.
 */
export function Transcript({ turns, call, userKey }: {
  turns: Turn[]
  call: { outcome: unknown; startedAt: string; durationSec: number }
  userKey: string
}) {
  const storageKey = `${CALL_TEXT_VIEW_KEY_PREFIX}${userKey}`
  const [view, setView] = useState<TextView>(() => readView(storageKey))
  const shown = turns.filter((t) => t.role !== 'tool')
  const state = translationState(turns, call)
  const pending = state === 'pending'
  const failText = state === 'failed' ? booqyFaultText('Utskriften kunde inte översättas.', 'translation_failed') : null

  function choose(key: string) {
    if (!isView(key)) return
    setView(key)
    try {
      localStorage.setItem(storageKey, key)
    } catch {
      // privat läge eller full lagring: valet gäller bara nu
    }
  }

  return (
    <>
      <div className="telefon-transcript__head">
        <h3 className="telefon-sub">
          Utskrift{' '}
          <InfoTooltip label="Utskrift">Maskinöversatt efter samtalet. Originalet ändras aldrig.</InfoTooltip>
        </h3>
        <Bar variant="tab" kind="track" label="Utskriftens språk" items={VIEWS} value={view} onChange={choose}
          panelId={() => 'telefon-transcript'} />
      </div>
      <div id="telefon-transcript" role="tabpanel" aria-label="Utskrift">
      {view !== 'original' && pending ? <p className="telefon-transcript__note"><Loading variant="inline" label="Översätter" /></p> : null}
      {view !== 'original' && failText ? <ErrorNote text={failText} /> : null}
      <ol className="telefon-transcript">
        {shown.map((t, i) => (
          <li key={i} className={`telefon-turn telefon-turn--${t.role}`}>
            <span className="telefon-turn__who">
              {ROLE[t.role] ?? t.role}
              {t.lang && t.lang !== 'sv' ? <span className="telefon-turn__chip">{langChip(t.lang)}</span> : null}
            </span>
            <span dir="auto" lang={view === 'original' || shownText(t, view) === t.text ? t.lang : view}>{shownText(t, view)}</span>
          </li>
        ))}
      </ol>
      </div>
    </>
  )
}
