import { expect, test } from "@playwright/test";

async function bodyIsLocked(page: import("@playwright/test").Page) {
  return page.evaluate(
    () => document.body.hasAttribute("data-scroll-locked") || getComputedStyle(document.body).overflow === "hidden"
  );
}

test("dialog longo restaura a rolagem ao fechar", async ({ page }) => {
  await page.goto("/manutencao", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Atualizar indicadores" })).toBeEnabled();
  await page.getByRole("tab", { name: "Ordens de servico" }).click();
  const openButton = page.getByRole("button", { name: "Nova OS manual" });
  await expect(openButton).toBeVisible();
  await page.waitForTimeout(250);
  await openButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await bodyIsLocked(page)).toBe(true);
  const dimensions = await dialog.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => bodyIsLocked(page)).toBe(false);
});

test("drawer mobile fecha na navegacao e remove o lock", async ({ page, viewport }) => {
  test.skip(!viewport || viewport.width >= 1024, "Fluxo exclusivo do menu mobile");
  await page.goto("/manutencao", { waitUntil: "domcontentloaded" });
  const menuButton = page.getByRole("button", { name: "Abrir menu" });
  await expect(menuButton).toBeVisible();
  await page.waitForTimeout(250);
  await menuButton.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect.poll(() => bodyIsLocked(page)).toBe(false);
  await expect(page.getByRole("button", { name: "Abrir menu" })).toBeVisible();
});

test("menus leves da topbar nao bloqueiam a pagina", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  const notificationsButton = page.getByRole("button", { name: /Notifica/ });
  await expect(notificationsButton).toBeVisible();
  await page.waitForTimeout(250);
  await notificationsButton.click();
  await expect(page.getByText("Alertas", { exact: true })).toBeVisible();
  expect(await bodyIsLocked(page)).toBe(false);
  await page.keyboard.press("Escape");
  await expect.poll(() => bodyIsLocked(page)).toBe(false);
});
