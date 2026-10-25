import { test, expect } from '@playwright/test';
import * as fs from 'fs';
test('Two browser tabs can complete a real multi-MB file transfer', async ({ browser }, testInfo) => {
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  // Peer 1 creates room
  await page1.goto('http://localhost:5173');
  await page1.getByRole('button', { name: 'Send', exact: true }).click();

  const testFile = testInfo.outputPath('test-3mb.bin');
  fs.writeFileSync(testFile, Buffer.alloc(3 * 1024 * 1024, 'a'));
  await page1.getByLabel('File Upload').setInputFiles(testFile);
  await page1.getByRole('button', { name: 'Send', exact: true }).click();

  // Wait for room code
  const roomText = await page1.locator('.text-5xl.font-mono').textContent();
  const roomCode = roomText?.trim();
  expect(roomCode).toHaveLength(10);

  // Peer 2 joins room
  await page2.goto('http://localhost:5173');
  await page2.getByRole('button', { name: 'Receive', exact: true }).click();
  await page2.fill('input[placeholder="Enter 10-Character Code"]', roomCode!);

  // Wait for connections (auto-joins at 10 characters)
  await expect(page1.locator('text=Connected')).toBeVisible({ timeout: 10000 });
  await expect(page2.locator('text=Connected')).toBeVisible({ timeout: 10000 });

  await page1.getByRole('button', { name: 'I verified this code' }).click();
  await page2.getByRole('button', { name: 'I verified this code' }).click();

  await page2.getByRole('button', { name: 'Accept', exact: true }).click();

  // Wait for completion on both sides
  await expect(page1.locator('text=SHA-256 MATCH')).toBeVisible({ timeout: 15000 });
  await expect(page2.locator('text=SHA-256 MATCH')).toBeVisible({ timeout: 15000 });

  await context1.close();
  await context2.close();
});

test('Two browser tabs can complete a verified multi-file batch transfer', async ({ browser }, testInfo) => {
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  await page1.goto('http://localhost:5173');
  await page1.getByRole('button', { name: 'Send', exact: true }).click();
  const fileA = testInfo.outputPath('batch-a.bin');
  const fileB = testInfo.outputPath('batch-b.bin');
  fs.writeFileSync(fileA, Buffer.alloc(256 * 1024, 'a'));
  fs.writeFileSync(fileB, Buffer.alloc(256 * 1024, 'b'));
  await page1.getByLabel('File Upload').setInputFiles([fileA, fileB]);
  await page1.getByRole('button', { name: 'Send', exact: true }).click();

  const roomCode = (await page1.locator('.text-5xl.font-mono').textContent())?.trim();
  expect(roomCode).toHaveLength(10);

  await page2.goto('http://localhost:5173');
  await page2.getByRole('button', { name: 'Receive', exact: true }).click();
  await page2.fill('input[placeholder="Enter 10-Character Code"]', roomCode!);
  await expect(page1.locator('text=Connected')).toBeVisible({ timeout: 10000 });
  await expect(page2.locator('text=Connected')).toBeVisible({ timeout: 10000 });
  await page1.getByRole('button', { name: 'I verified this code' }).click();
  await page2.getByRole('button', { name: 'I verified this code' }).click();
  await page2.getByRole('button', { name: 'Accept', exact: true }).click();

  await expect(page1.locator('text=SHA-256 MATCH')).toBeVisible({ timeout: 15000 });
  await expect(page2.locator('text=SHA-256 MATCH')).toBeVisible({ timeout: 15000 });
  await context1.close();
  await context2.close();
});
