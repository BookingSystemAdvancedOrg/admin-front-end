import { Icon } from '../../shared/Icon'
import { reloadFresh } from '../../shared/updateNotice'

/**
 * Servern har en nyare version av texten än den som byggdes in i appen
 * (409 vid godkännandet). Texten kommer med nästa version av appen, så en
 * omladdning är rätt åtgärd här (en deploy, inte data).
 */
export function NewVersionNote({ what }: { what: 'avtalet' | 'villkoren' }) {
  return (
    <div className="form-error error-note" role="alert">
      <p className="error-note-text">
        En ny version av {what} är på väg till appen. Ladda om och godkänn igen.
      </p>
      <div className="error-note-body">
        <div className="error-note-actions">
          <button type="button" className="btn outline square" onClick={() => void reloadFresh()}>
            <Icon name="rotate" size={16} />
            Ladda om
          </button>
        </div>
      </div>
    </div>
  )
}
