import { SoundToggle } from '../../shared/SoundToggle'
import { SoundVolume } from '../../shared/SoundVolume'
import { ThemeToggle } from '../../shared/ThemeToggle'

/**
 * Utseende och ljud: ljust eller mörkt läge och klickljudet. Valen gäller den
 * här webbläsaren (localStorage, se shared/storageRegistry) och samma nycklar
 * används på booqy.se och i Booqy Console. Ljust, ljud på och volym 70 % är standard.
 */
export function AppearanceCard() {
  return (
    <section id="utseende" className="admin-card table-card">
      <h2 className="card-title">Utseende och ljud</h2>
      <div style={{ height: 8 }} />
      <p className="cell-muted">Gäller den här webbläsaren. Ljust läge och klickljud är på från början.</p>
      <div className="appearance-rows">
        <div className="appearance-row">
          <div>
            <p className="appearance-title">Mörkt läge</p>
            <p className="cell-muted">Mörka ytor i stället för ljusa, till exempel i en mörk lokal på kvällen.</p>
          </div>
          <ThemeToggle label className="appearance-toggle" />
        </div>
        <div className="appearance-row">
          <div>
            <p className="appearance-title">Klickljud</p>
            <p className="cell-muted">Ett mjukt klick när du trycker på knappar och länkar.</p>
          </div>
          <SoundToggle label className="appearance-toggle" />
        </div>
        <div className="appearance-row">
          <div>
            <label className="appearance-title" htmlFor="sound-volume">Volym</label>
            <p className="cell-muted">Hur högt klicket låter. 70 % är standard, 0 % är tyst.</p>
          </div>
          <SoundVolume id="sound-volume" />
        </div>
      </div>
    </section>
  )
}
