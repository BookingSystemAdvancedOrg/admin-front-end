import './changedNote.css'

/**
 * Lugn rad under ett fält: värdet ändrades nyss på annat håll (en kollega,
 * en annan plats) medan du redigerade. Ditt värde står kvar i fältet;
 * "Använd" tar det andra. Visas både när posten ändrats under tiden du
 * redigerar och när en sparning stannat på samma fält (shared/merge.ts).
 */
export function ChangedNote({
  value,
  onUse,
  id,
  as: Tag = 'p',
}: {
  /** Det andra värdet, färdigformaterat ("129 kr"); utan värde gäller raden hela kortet. */
  value?: string
  /** Byt till det andra värdet; utelämnas när det inte går att välja. */
  onUse?: () => void
  id?: string
  /** 'span' inuti ett fälts hjälptext (brand Field), annars ett eget stycke. */
  as?: 'p' | 'span'
}) {
  return (
    <Tag className="changed-note" role="status" id={id}>
      <span>
        {value === undefined ? (
          'Ändrades nyss på en annan plats. Ditt står kvar tills du sparar.'
        ) : (
          <>
            Ändrades nyss på en annan plats: <strong>{value === '' ? 'tomt' : value}</strong>
          </>
        )}
      </span>
      {onUse && (
        <button type="button" className="changed-note-use" onClick={onUse}>
          Använd
        </button>
      )}
    </Tag>
  )
}
