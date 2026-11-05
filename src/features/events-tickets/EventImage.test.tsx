import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EventEditor from './EventEditor'
import * as api from './api'
import * as menuApi from '../meny/menuApi'
import { EVENT_IMAGE_MAX_BYTES, imageAltError, imageFields, imageFileError, initialImage } from './eventImage'

vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  createEvent: vi.fn(), updateEvent: vi.fn(),
}))
vi.mock('../meny/menuApi', async (orig) => ({
  ...(await orig<typeof import('../meny/menuApi')>()),
  uploadMenuImage: vi.fn(),
  menuImageUrl: (key: string) => `https://cdn.example/${key}`,
}))

const KEY = 'menu-images/t1/locations/loc-a-1/menu/0f8fad5b-d9cb-469f-a165-70867728950e.webp'
const detail: api.EventDetail = {
  eventId: 'EVENT1AAAAAAAA', locationId: 'loc-a-1', title: 'Vinmiddag', description: '', status: 'draft',
  settings: { perOrderMax: 6, transferAllowed: true }, version: 3, occurrences: [], ticketTypes: [],
  imageKey: KEY, imageAlt: 'Dukat långbord',
}

function file(type = 'image/webp', size = 1000) {
  const f = new File(['x'], 'bild.webp', { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  vi.mocked(api.updateEvent).mockResolvedValue(detail)
  vi.mocked(api.createEvent).mockResolvedValue(detail)
  vi.mocked(menuApi.uploadMenuImage).mockResolvedValue(KEY)
})

describe('eventImage helpers', () => {
  it('accepts only the menu image types up to 5 MB', () => {
    expect(imageFileError(file())).toBeNull()
    expect(imageFileError(file('image/gif'))).toBe('Bilden måste vara AVIF, JPEG, PNG eller WebP.')
    expect(imageFileError(file('image/png', EVENT_IMAGE_MAX_BYTES + 1))).toBe('Bilden får vara högst 5 MB.')
  })

  it('needs alt text only with an image', () => {
    expect(imageAltError(initialImage())).toBeNull()
    expect(imageAltError({ key: KEY, file: null, alt: '  ' })).toBe('Beskriv bilden för den som inte ser den.')
    expect(imageAltError({ key: KEY, file: null, alt: 'Bord' })).toBeNull()
  })

  it('uploads a new file through the menu image upload and sends no fields without an image', async () => {
    await expect(imageFields('loc-a-1', initialImage())).resolves.toEqual({})
    await expect(imageFields('loc-a-1', { key: null, file: file(), alt: ' Bord ' })).resolves.toEqual({ imageKey: KEY, imageAlt: 'Bord' })
    expect(menuApi.uploadMenuImage).toHaveBeenCalledWith('loc-a-1', expect.any(File))
    await expect(imageFields('loc-a-1', { key: KEY, file: null, alt: 'Bord' })).resolves.toEqual({ imageKey: KEY, imageAlt: 'Bord' })
    expect(menuApi.uploadMenuImage).toHaveBeenCalledTimes(1)
  })
})

describe('EventEditor image', () => {
  it('shows the saved image with its alt text and keeps it on save', async () => {
    render(<EventEditor locationId="loc-a-1" existing={detail} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Bild' })).toBeInTheDocument()
    expect(document.querySelector('img.evenemang-image-preview')?.getAttribute('src')).toBe(`https://cdn.example/${KEY}`)
    expect(screen.getByLabelText(/Bildtext för skärmläsare/)).toHaveValue('Dukat långbord')
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.updateEvent).toHaveBeenCalled())
    expect(vi.mocked(api.updateEvent).mock.calls[0][2]).toMatchObject({ imageKey: KEY, imageAlt: 'Dukat långbord', version: 3 })
    expect(menuApi.uploadMenuImage).not.toHaveBeenCalled()
  })

  it('refuses a too large file before any upload', () => {
    render(<EventEditor locationId="loc-a-1" existing={{ ...detail, imageKey: undefined, imageAlt: undefined }} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByTestId('event-image-input'), { target: { files: [file('image/jpeg', EVENT_IMAGE_MAX_BYTES + 1)] } })
    expect(screen.getByText('Bilden får vara högst 5 MB.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Bildtext för skärmläsare/)).toBeNull()
  })

  it('requires alt text for a new image, then uploads it and saves the key', async () => {
    render(<EventEditor locationId="loc-a-1" existing={{ ...detail, imageKey: undefined, imageAlt: undefined }} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByTestId('event-image-input'), { target: { files: [file()] } })
    expect(document.querySelector('img.evenemang-image-preview')?.getAttribute('src')).toBe('blob:preview')
    // Fältet är obligatoriskt: webbläsaren stoppar sparningen innan något laddas upp.
    const alt = screen.getByLabelText(/Bildtext för skärmläsare/) as HTMLInputElement
    expect(alt).toBeRequired()
    expect(alt.checkValidity()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    expect(api.updateEvent).not.toHaveBeenCalled()
    // Bara blanksteg räknas inte som en bildtext.
    fireEvent.change(alt, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    expect(await screen.findAllByText('Beskriv bilden för den som inte ser den.')).toHaveLength(2)
    expect(alt).toHaveAttribute('aria-invalid', 'true')
    expect(menuApi.uploadMenuImage).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/Bildtext för skärmläsare/), { target: { value: 'Ostbricka med druvor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.updateEvent).toHaveBeenCalled())
    expect(vi.mocked(api.updateEvent).mock.calls[0][2]).toMatchObject({ imageKey: KEY, imageAlt: 'Ostbricka med druvor' })
  })

  it('does not save when the upload fails, and does not upload twice when only the save fails', async () => {
    vi.mocked(menuApi.uploadMenuImage).mockRejectedValueOnce(new Error('nope'))
    render(<EventEditor locationId="loc-a-1" existing={{ ...detail, imageKey: undefined, imageAlt: undefined }} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByTestId('event-image-input'), { target: { files: [file()] } })
    fireEvent.change(screen.getByLabelText(/Bildtext för skärmläsare/), { target: { value: 'Bord' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(menuApi.uploadMenuImage).toHaveBeenCalledTimes(1))
    expect(api.updateEvent).not.toHaveBeenCalled()
    vi.mocked(api.updateEvent).mockRejectedValueOnce(new Error('save failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.updateEvent).toHaveBeenCalledTimes(1))
    expect(menuApi.uploadMenuImage).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.updateEvent).toHaveBeenCalledTimes(2))
    expect(menuApi.uploadMenuImage).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.updateEvent).mock.calls[1][2]).toMatchObject({ imageKey: KEY, imageAlt: 'Bord' })
  })

  it('removing the image sends no image fields', async () => {
    render(<EventEditor locationId="loc-a-1" existing={detail} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ta bort bilden' }))
    expect(screen.getByText('Ingen bild')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.updateEvent).toHaveBeenCalled())
    const body = vi.mocked(api.updateEvent).mock.calls[0][2]
    expect(body.imageKey).toBeUndefined()
    expect(body.imageAlt).toBeUndefined()
  })
})
