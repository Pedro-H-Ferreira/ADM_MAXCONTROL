import { expect, test } from "@playwright/test";

test("Fluig abre sem duplicar recursos e pagina no servidor", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "notebook-1366", "A rede e validada uma vez no viewport de notebook.");

  const requests: Array<{ method: string; path: string }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/fluig/adm/")) {
      requests.push({ method: request.method(), path: `${url.pathname}${url.search}` });
    }
  });

  await page.goto("/pagamentos", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Proxima pagina" })).toBeEnabled();
  await expect(page.getByText(/1-50 de \d+/)).toBeVisible();

  const initialResources = [
    "/api/fluig/adm/agent/pair",
    "/api/fluig/adm/tasks/my?limit=40&module=pagamentos",
    "/api/fluig/adm/requests?module=pagamentos&page=1&pageSize=50&open=true&mine=true",
    "/api/fluig/adm/requests/my-open?limit=1&module=pagamentos",
    "/api/fluig/adm/sync/state?module=pagamentos",
    "/api/fluig/adm/jobs?limit=50",
  ];
  for (const resource of initialResources) {
    expect(requests.filter((request) => request.method === "GET" && request.path === resource)).toHaveLength(1);
  }
  expect(requests.some((request) => request.path.includes("/sync/historical"))).toBe(false);
  expect(requests.some((request) => request.method === "POST" && request.path === "/api/fluig/adm/sync")).toBe(false);

  await page.getByRole("button", { name: "Proxima pagina" }).click();
  await expect(page.getByText(/51-100 de \d+/)).toBeVisible();
  expect(requests.filter((request) => request.path.includes("page=2&pageSize=50"))).toHaveLength(1);

  await page.getByPlaceholder("Numero Fluig, fornecedor, CNPJ, solicitante ou etapa").fill("1163457");
  await expect.poll(() => requests.filter((request) => request.path.includes("q=1163457")).length).toBe(1);
  await expect(page.getByText("1-1 de 1")).toBeVisible();
});

test("todos os submodulos de manutencao carregam sem erro de API", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "notebook-1366", "O smoke funcional e validado uma vez no viewport de notebook.");

  const apiFailures: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/manutencao") && response.status() >= 500) {
      apiFailures.push(`${response.status()} ${url.pathname}${url.search}`);
    }
  });

  await page.goto("/manutencao", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Resumo operacional" })).toBeVisible();

  const modules = [
    { tab: "Ordens de servico", visible: page.getByRole("button", { name: "Nova OS manual" }) },
    { tab: "Ativos", visible: page.getByRole("heading", { name: "Ativos e equipamentos" }) },
    { tab: "Estoque", visible: page.getByRole("heading", { name: "Estoque de manutencao" }) },
    { tab: "Movimentacoes", visible: page.getByRole("heading", { name: "Movimentacoes de estoque" }) },
    { tab: "Inventarios", visible: page.getByRole("heading", { name: "Inventarios" }) },
    { tab: "Preventivas", visible: page.getByRole("heading", { name: "Planos preventivos" }) },
    { tab: "Calendario", visible: page.getByRole("heading", { name: "Calendario de manutencao" }) },
    { tab: "Prestadores", visible: page.getByRole("heading", { name: "Fornecedores e prestadores" }) },
    { tab: "Relatorios", visible: page.getByRole("heading", { name: "Relatorios de manutencao" }) },
    { tab: "Configuracoes", visible: page.getByRole("heading", { name: "Configuracoes de manutencao" }) },
  ];

  for (const submodule of modules) {
    await page.getByRole("tab", { name: submodule.tab, exact: true }).click();
    await expect(submodule.visible).toBeVisible();
  }

  expect(apiFailures).toEqual([]);
});
