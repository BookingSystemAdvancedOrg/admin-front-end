import { Bar, Button } from '@booqy/brand'
import { errorInfo } from '../../shared/errors'
import { ErrorActions } from '../../shared/ErrorNote'
import { SETUP } from './api'

/**
 * Ett fel i en banderoll. Booqys fel får Försök igen och Rapportera till
 * Booqy, ett fel med en plats att rätta det på får den knappen, annars
 * bara Försök igen.
 */
export function RetryBanner({ text, onRetry }: { text: string; onRetry: () => void }) {
  const info = errorInfo(text)
  const actions = info?.actor === 'booqy' || info?.link
  return (
    <Bar variant="banner" tone="danger" action={actions
      ? <ErrorActions text={text} onRetry={onRetry} />
      : <Button size="sm" variant="secondary" type="button" onClick={onRetry}>{SETUP.buttons.retry}</Button>}>
      {text}
    </Bar>
  )
}
