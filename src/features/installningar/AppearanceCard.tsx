import { BackdropSetting } from '../../shared/BackdropSetting'
import { SoundToggle } from '../../shared/SoundToggle'
import { SoundVolume } from '../../shared/SoundVolume'
import { ThemeToggle } from '../../shared/ThemeToggle'
import { TitleInfo } from '../../shared/TitleInfo'
import { InfoTooltip } from '../../shared/InfoTooltip'

/**
 * Utseende och ljud: ljust eller mörkt läge och klickljudet. Valen gäller den
 * här webbläsaren (localStorage, se shared/storageRegistry) och samma nycklar
 * används på booqy.se och i Booqy Console. Ljust, ljud på och volym 40 % är standard.
 */
export function AppearanceCard() {
  return (
    <section id="utseende" className="admin-card table-card">
      <TitleInfo title="Utseende och ljud" info="Gäller den här webbläsaren. Ljust läge och klickljud är på från början." />
      <div className="appearance-rows">
        <div className="appearance-row" data-help="utseende:tema">
          <div>
            <p className="appearance-title">Ljust eller mörkt</p>
          </div>
          <ThemeToggle label className="appearance-toggle" />
        </div>
        <div className="appearance-row" data-help="utseende:bakgrund">
          <div>
            <div className="title-info">
              <p className="appearance-title">Bakgrund</p>
              <InfoTooltip label="Bakgrund">
                Det som ligger bakom glaset: en färg eller en egen bild. Genomskinligt, där skrivbordet syns igenom, finns i skrivbordsappen.
              </InfoTooltip>
            </div>
          </div>
          <BackdropSetting />
        </div>
        <div className="appearance-row" data-help="utseende:klickljud">
          <div>
            <p className="appearance-title">Klickljud</p>
          </div>
          <SoundToggle label className="appearance-toggle" />
        </div>
        <div className="appearance-row" data-help="utseende:volym">
          <div>
            <label className="appearance-title" htmlFor="sound-volume">Volym</label>
          </div>
          <SoundVolume id="sound-volume" />
        </div>
      </div>
    </section>
  )
}
