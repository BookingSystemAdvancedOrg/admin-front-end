import { CallbackList } from './CallbacksTab'

/** Bokningar > panel: öppna återuppringningar från telefonassistenten ("Ring upp", "Klar"). Syns bara när någon väntar. */
export default function CallbacksPanel({ locationId }: { locationId: string; date: string }) {
  return <CallbackList locationId={locationId} title="Vill bli uppringda" compact />
}
