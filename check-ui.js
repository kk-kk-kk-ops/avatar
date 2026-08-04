const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:3000/dev-preview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const joinButton = page.locator('button', { hasText: /入室|参加|入る/ });
  if (await joinButton.count() > 0) {
    await joinButton.first().click();
    await page.waitForTimeout(1200);
  }

  await page.screenshot({ path: 'C:/Users/konef/AppData/Local/Temp/claude/c--Users-konef-Desktop-avatar-space/0b971a8f-2f4f-4884-b323-d2f7fab615ee/scratchpad/sidebar-1.png' });

  // open settings modal
  const gear = page.locator('button[aria-label="アバター・名前の設定"]');
  await gear.click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'C:/Users/konef/AppData/Local/Temp/claude/c--Users-konef-Desktop-avatar-space/0b971a8f-2f4f-4884-b323-d2f7fab615ee/scratchpad/settings-modal-1.png' });

  // select "busy" radio and save
  const radios = page.locator('input[name="presence-status"]');
  await radios.nth(1).check();
  await page.locator('button', { hasText: '保存する' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'C:/Users/konef/AppData/Local/Temp/claude/c--Users-konef-Desktop-avatar-space/0b971a8f-2f4f-4884-b323-d2f7fab615ee/scratchpad/sidebar-2-busy.png' });

  await browser.close();
})();
