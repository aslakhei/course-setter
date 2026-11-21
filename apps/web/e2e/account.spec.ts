import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { admin, createUser, deleteUsers, pageFor, type TestUser } from './users.ts'

const users: TestUser[] = []
const clubName = `E2E account ${randomUUID().slice(0, 8)}`

test.afterAll(async () => {
  await admin.from('clubs').delete().eq('name', clubName)
  await deleteUsers(users)
})

test('download my data, delete a club, and delete my account', async ({ browser }) => {
  const [ada, mo] = await Promise.all([createUser('Ada Admin'), createUser('Mo Member')])
  users.push(ada, mo)
  const page = await pageFor(browser, ada)
  await page.goto('/')
  await page.getByLabel('Club name').fill(clubName)
  await page.getByRole('button', { name: 'Create club' }).click()
  await expect(page.getByRole('heading', { level: 1, name: clubName })).toBeVisible()
  const clubUrl = page.url()
  const clubId = clubUrl.split('/clubs/')[1]?.split('/')[0] ?? ''
  await admin.from('club_members').insert({ club_id: clubId, user_id: mo.id, role: 'member' })

  // Your account, from the account menu.
  await page.getByRole('button', { name: /^Account:/ }).click()
  await page.getByRole('link', { name: 'Your account' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible()

  // My data as JSON.
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my data' }).click()])
  expect(file.suggestedFilename()).toBe('course-setter-my-data.json')
  const data = JSON.parse(readFileSync(await file.path(), 'utf8'))
  expect(data.account.id).toBe(ada.id)
  expect(data.clubs).toEqual([expect.objectContaining({ club: clubName, role: 'admin' })])

  // The only admin of a club with a member cannot delete her account yet.
  const remove = page.getByRole('button', { name: 'Delete my account' })
  await expect(remove).toBeDisabled()
  await page.getByLabel('I understand that this cannot be undone').check()
  await remove.click()
  await expect(page.getByText(`You are the only admin of ${clubName}.`)).toBeVisible()

  // She deletes the club instead (its name must be typed).
  await page.goto(`${clubUrl}/settings`)
  const deleteClub = page.getByRole('button', { name: 'Delete club' })
  await expect(deleteClub).toBeDisabled()
  await page.getByLabel(`Type “${clubName}” to confirm`).fill(clubName)
  await deleteClub.click()
  await expect(page.getByRole('heading', { name: 'Your clubs' })).toBeVisible()
  await expect(page.getByText(clubName)).toHaveCount(0)
  expect((await admin.from('clubs').select('id').eq('id', clubId)).data).toEqual([])

  // Now the account goes, and she is signed out.
  await page.goto('/account')
  await page.getByLabel('I understand that this cannot be undone').check()
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  expect((await admin.auth.admin.getUserById(ada.id)).data.user).toBeNull()
})
