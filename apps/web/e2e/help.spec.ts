import { expect, test } from '@playwright/test'
import { createUser, deleteUsers, pageFor, type TestUser } from './users.ts'

const users: TestUser[] = []

test.afterAll(async () => {
  await deleteUsers(users)
})

test('a visitor reads what the app is and how it works before signing in', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('A club’s admins upload its OCAD or PDF maps once.')).toBeVisible()
  await page.getByRole('link', { name: 'How it works' }).click()
  await expect(page).toHaveURL(/\/help$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Getting started' })).toBeVisible()
  await expect(page.getByText('Print the PDF at actual size (100 %).')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await page.getByRole('link', { name: 'how to put a training on Livelox' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Put a training on Livelox' })).toBeVisible()
  // Other pages still ask to sign in.
  await page.goto('/account')
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
})

test('help is in the account menu', async ({ browser }) => {
  const ada = await createUser('Ada Admin')
  users.push(ada)
  const page = await pageFor(browser, ada)
  await page.goto('/')
  await page.getByRole('button', { name: /^Account:/ }).click()
  await page.getByRole('link', { name: 'Help' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Getting started' })).toBeVisible()
})
