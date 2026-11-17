import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MyAvatarButton } from './ProfilePicture'

const store = vi.hoisted(() => ({ removeMyAvatar: vi.fn(), mine: { url: 'https://img.example/me.jpg', loaded: true } }))
vi.mock('./avatarStore', async (orig) => ({
  ...(await orig<typeof import('./avatarStore')>()),
  getMyAvatar: () => store.mine,
  subscribeMyAvatar: () => () => {},
  loadMyAvatar: vi.fn(),
  removeMyAvatar: store.removeMyAvatar,
}))

describe('ProfilePicture', () => {
  it('says a failed removal is Booqys fault and retries the removal', async () => {
    store.removeMyAvatar.mockResolvedValueOnce(false).mockResolvedValue(true)
    render(<MyAvatarButton name="Olle" email="olle@example.com" />)
    fireEvent.click(screen.getByRole('button', { name: 'Profilbild' }))
    const dialog = screen.getByRole('dialog', { name: 'Profilbild' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ta bort bild' }))
    expect(await within(dialog).findByText(/Bilden kunde inte tas bort\. Felet ligger hos Booqy/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Rapportera till Booqy' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Försök igen' }))
    expect(store.removeMyAvatar).toHaveBeenCalledTimes(2)
  })
})
