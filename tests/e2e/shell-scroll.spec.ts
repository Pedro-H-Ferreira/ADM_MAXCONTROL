import { expect, test, type Page } from "@playwright/test";

const routes = [
  "/dashboard",
  "/despesas",
  "/pagamentos",
  "/contratos",
  "/fornecedores",
  "/produtos",
  "/compras",
  "/cotacoes",
  "/manutencao",
  "/tarefas",
  "/checklists",
  "/usuarios",
  "/notificacoes",
  "/relatorios",
  "/auditoria",
  "/configuracoes",
  "/perfil",
] as const;

async function scrollState(page: Page) {
  return page.evaluate(() => ({
    bodyLocked: document.body.hasAttribute("data-scroll-locked") || getComputedStyle(document.body).overflow === "hidden",
    clientHeight: document.documentElement.clientHeight,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollY: window.scrollY,
  }));
}

async function swipeUp(page: Page) {
  const viewport = page.viewportSize() || { width: 390, height: 800 };
  const startY = Math.min(viewport.height - 80, 700);
  const candidates = [8, 24, Math.max(8, viewport.width - 8), Math.floor(viewport.width / 2)];

  for (const x of candidates) {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
      for (const y of [startY - 80, startY - 160, startY - 240, startY - 320, startY - 400, startY - 480]) {
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
        await page.waitForTimeout(32);
      }
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(120);
      if ((await scrollState(page)).scrollY > 0) return;
    } finally {
      await session.detach();
    }
  }
}

async function focusScrollOwner(page: Page) {
  await page.evaluate(() => {
    const owner = document.querySelector("main") || document.body;
    (owner as HTMLElement).focus({ preventScroll: true });
  });
}

async function pressDocumentShortcut(page: Page, shortcut: "Control+End" | "Control+Home") {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await focusScrollOwner(page);
    await page.keyboard.press(shortcut);
    await page.waitForTimeout(250);
    const state = await scrollState(page);
    const reachedTarget =
      shortcut === "Control+Home"
        ? state.scrollY <= 1
        : state.scrollY + state.clientHeight >= state.scrollHeight - 4;
    if (reachedTarget) return;
  }
}

test.describe("rolagem global", () => {
  for (const route of routes) {
    test(`${route} usa o documento como scroll vertical`, async ({ page, isMobile }) => {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("h1").first()).toBeVisible();
      await expect.poll(async () => (await scrollState(page)).bodyLocked).toBe(false);

      const initial = await scrollState(page);
      expect(initial.scrollWidth).toBeLessThanOrEqual(initial.clientWidth + 1);
      if (initial.scrollHeight <= initial.clientHeight + 32) return;

      if (isMobile) {
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await swipeUp(page);
        await expect.poll(async () => (await scrollState(page)).scrollY).toBeGreaterThan(0);
        return;
      }

      await page.mouse.wheel(0, 700);
      await expect.poll(async () => (await scrollState(page)).scrollY).toBeGreaterThan(0);

      await pressDocumentShortcut(page, "Control+End");
      await expect.poll(async () => {
        const state = await scrollState(page);
        return state.scrollY + state.clientHeight;
      }).toBeGreaterThanOrEqual(initial.scrollHeight - 4);

      await pressDocumentShortcut(page, "Control+Home");
      await expect.poll(async () => (await scrollState(page)).scrollY).toBeLessThanOrEqual(1);

      await focusScrollOwner(page);
      await page.keyboard.press("PageDown");
      await expect.poll(async () => (await scrollState(page)).scrollY).toBeGreaterThan(0);
      await page.waitForTimeout(500);
      const afterPageDown = (await scrollState(page)).scrollY;
      await page.keyboard.press("PageUp");
      await expect.poll(async () => (await scrollState(page)).scrollY).toBeLessThan(afterPageDown);

      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.mouse.move(
        Math.floor((page.viewportSize()?.width || 390) / 2),
        Math.floor((page.viewportSize()?.height || 800) / 2)
      );
      for (let step = 0; step < 4; step += 1) {
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(24);
      }
      await expect.poll(async () => (await scrollState(page)).scrollY).toBeGreaterThan(0);

      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await expect.poll(async () => (await scrollState(page)).scrollY).toBeGreaterThan(0);
    });
  }
});
