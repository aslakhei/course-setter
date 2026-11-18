import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Menu } from './Menu.tsx'
import { initials } from './ui.tsx'

describe('Menu', () => {
  it('opens on click and closes on Escape, outside click or choosing an item', async () => {
    render(
      <>
        <Menu label="Switch club" button="Clubs" buttonClassName="">
          {close => (
            <button type="button" onClick={close}>
              Skogly OK
            </button>
          )}
        </Menu>
        <p>Outside</p>
      </>,
    )
    const toggle = screen.getByRole('button', { name: 'Switch club' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Skogly OK')).toBeNull()

    await userEvent.click(toggle)
    await userEvent.click(screen.getByText('Outside'))
    expect(screen.queryByText('Skogly OK')).toBeNull()

    await userEvent.click(toggle)
    await userEvent.click(screen.getByText('Skogly OK'))
    expect(screen.queryByText('Skogly OK')).toBeNull()
  })
})

describe('initials', () => {
  it.each([
    ['Ada Hansen', 'AH'],
    ['Skogly OK', 'SO'],
    ['Mo', 'M'],
    ['  kari   lund  berg ', 'KB'],
    ['', '?'],
  ])('%s -> %s', (name, expected) => expect(initials(name)).toBe(expected))
})
