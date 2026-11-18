import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { admin, createUser, deleteUsers, pageFor, type TestUser } from './users.ts'

const users: TestUser[] = []
const clubName = `E2E club ${randomUUID().slice(0, 8)}`

test.afterAll(async () => {
  await admin.from('clubs').delete().eq('name', clubName)
  await deleteUsers(users)
})

test('create a club, invite a member who joins, and keep outsiders out', async ({ browser }) => {
  const [ada, mo, oz] = await Promise.all([createUser('Ada Admin'), createUser('Mo Member'), createUser('Oz Outsider')])
  users.push(ada, mo, oz)

  // Ada creates the club and an invite link.
  const adaPage = await pageFor(browser, ada)
  await adaPage.goto('/')
  await expect(adaPage.getByRole('heading', { name: 'Your clubs' })).toBeVisible()
  await adaPage.getByLabel('Club name').fill(clubName)
  await adaPage.getByRole('button', { name: 'Create club' }).click()
  await expect(adaPage.getByRole('heading', { level: 1, name: clubName })).toBeVisible()
  await expect(adaPage.getByText('1 member · Admin')).toBeVisible()
  const clubUrl = adaPage.url()

  await adaPage.getByRole('navigation', { name: 'Club' }).getByRole('link', { name: 'Members' }).click()
  await adaPage.getByRole('button', { name: 'Create link' }).click()
  const inviteLink = (await adaPage.getByTestId('invite-link').first().textContent()) ?? ''
  expect(inviteLink).toMatch(/\/invite\/[A-Za-z0-9_-]{24}$/)

  // Mo opens the link, joins and lands on the club.
  const moPage = await pageFor(browser, mo)
  await moPage.goto(inviteLink)
  await expect(moPage.getByText(`You have been invited to join ${clubName}.`)).toBeVisible()
  await moPage.getByRole('button', { name: `Join ${clubName}` }).click()
  await expect(moPage.getByRole('heading', { level: 1, name: clubName })).toBeVisible()
  await expect(moPage.getByText('2 members · Member')).toBeVisible()
  await expect(moPage.getByRole('link', { name: 'Settings' })).toHaveCount(0)

  // Opening the link again says Mo is already in.
  await moPage.goto(inviteLink)
  await expect(moPage.getByText(`You are already a member of ${clubName}.`)).toBeVisible()

  // Ada sees Mo in the member list and can make Mo admin.
  await adaPage.reload()
  await expect(adaPage.getByRole('cell', { name: 'Mo Member', exact: true })).toBeVisible()
  await expect(adaPage.getByLabel('Role for Mo Member')).toHaveValue('member')

  // Oz has neither link nor membership: the club stays hidden.
  const ozPage = await pageFor(browser, oz)
  await ozPage.goto(clubUrl)
  await expect(ozPage.getByText('This club does not exist, or you are not a member of it.')).toBeVisible()
  await ozPage.goto('/')
  await expect(ozPage.getByText('You are not in a club yet.', { exact: false })).toBeVisible()

  // Ada revokes the link; it stops working for Oz.
  await adaPage.getByRole('button', { name: 'Revoke' }).click()
  await expect(adaPage.getByText(/^Revoked /)).toBeVisible()
  await ozPage.goto(inviteLink)
  await expect(ozPage.getByText(`This invite link to ${clubName} is no longer valid.`, { exact: false })).toBeVisible()
  await expect(ozPage.getByRole('button', { name: /^Join / })).toHaveCount(0)
})

test('an invite link asks visitors who are not signed in to sign in first', async ({ page }) => {
  await page.goto('/invite/some-token')
  await expect(page.getByText('You have been invited to join a club on Course setter.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
})
