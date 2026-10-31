import { SkelCard, SkelPage, SkelTiles } from '../../shared/Skeleton'

/**
 * Medan statistiken hämtas: samma nyckeltal, diagram och två kort som den
 * riktiga översikten, som suddiga glasrutor (shared/Skeleton).
 */
export function OverviewSkeleton() {
  return (
    <SkelPage label="Hämtar statistiken">
      <SkelTiles />
      <SkelCard chart />
      <div className="mk-two" aria-hidden="true">
        <SkelCard aside={false} rows={3} />
        <SkelCard rows={2} />
      </div>
    </SkelPage>
  )
}
