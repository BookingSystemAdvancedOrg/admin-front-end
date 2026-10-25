import { PASSWORD_RULES } from './passwordRules'
import { Icon } from '../../shared/Icon'

/** Checklistan under lösenordsfälten: bockas av medan man skriver. */
export function PasswordRulesList({ password }: { password: string }) {
  return (
    <ul className="auth-rules" aria-label="Lösenordskrav">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password)
        return (
          <li key={rule.id} className={met ? 'auth-rule met' : 'auth-rule'}>
            <Icon name={met ? 'check' : 'circle'} size={14} />
            {rule.label}
          </li>
        )
      })}
    </ul>
  )
}
