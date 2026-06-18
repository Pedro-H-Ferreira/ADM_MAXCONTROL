/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const { chromium } = require("playwright");
const config = require("../config");

function appendSessionTrace(message) {
  const tracePath = process.env.FLUIG_TRACE_FILE;
  if (!tracePath) {
    return;
  }

  fs.appendFileSync(tracePath, `[${new Date().toISOString()}] [session] ${message}\n`, "utf8");
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntilPageSettles(page, label) {
  appendSessionTrace(`Aguardando pagina estabilizar: ${label}`);
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}

function locatorCandidates(page, candidates) {
  return candidates
    .filter((candidate) => candidate && candidate.value)
    .map((candidate) => {
      if (candidate.kind === "label") {
        return {
          label: candidate.label,
          locator: page.getByLabel(candidate.value, { exact: false })
        };
      }

      if (candidate.kind === "role") {
        return {
          label: candidate.label,
          locator: page.getByRole(candidate.role, { name: candidate.value, exact: candidate.exact !== false })
        };
      }

      if (candidate.kind === "text") {
        return {
          label: candidate.label,
          locator: page.getByText(candidate.value, { exact: candidate.exact !== false })
        };
      }

      return {
        label: candidate.label || candidate.value,
        locator: page.locator(candidate.value)
      };
    });
}

async function findVisibleLocator(page, candidates, label, timeout = 45000) {
  const startedAt = Date.now();
  const options = locatorCandidates(page, candidates);
  let lastError = "";

  while (Date.now() - startedAt < timeout) {
    for (const candidate of options) {
      try {
        const count = await candidate.locator.count();
        for (let index = 0; index < Math.min(count, 5); index += 1) {
          const item = candidate.locator.nth(index);
          if (await item.isVisible().catch(() => false)) {
            appendSessionTrace(`${label} encontrado por ${candidate.label}`);
            return item;
          }
        }
      } catch (error) {
        lastError = error.message || String(error);
      }
    }

    await delay(500);
  }

  throw new Error(`${label} nao encontrado na tela de login. URL atual: ${page.url()}${lastError ? ` | ${lastError}` : ""}`);
}

function loginUserCandidates() {
  return [
    { value: config.selectors.loginUser, label: `env ${config.selectors.loginUser}` },
    { value: "#username", label: "#username" },
    { value: "input#username", label: "input#username" },
    { value: "input[name='username']", label: "input[name='username']" },
    { value: "input[name='email']", label: "input[name='email']" },
    { value: "input[type='email']", label: "input[type='email']" },
    { value: "input[autocomplete='username']", label: "input[autocomplete='username']" },
    { value: "input[placeholder*='mail' i]", label: "placeholder email" },
    { value: "E-MAIL", kind: "label", label: "label E-MAIL" },
    { value: "Email", kind: "label", label: "label Email" },
    { value: "input[type='text']", label: "primeiro input texto" }
  ];
}

function loginPasswordCandidates() {
  return [
    { value: config.selectors.loginPassword, label: `env ${config.selectors.loginPassword}` },
    { value: "#password", label: "#password" },
    { value: "input#password", label: "input#password" },
    { value: "input[name='password']", label: "input[name='password']" },
    { value: "input[type='password']", label: "input[type='password']" },
    { value: "input[autocomplete='current-password']", label: "autocomplete current-password" },
    { value: "SENHA", kind: "label", label: "label SENHA" },
    { value: "Senha", kind: "label", label: "label Senha" }
  ];
}

function loginSubmitCandidates() {
  return [
    { value: config.selectors.loginSubmit, label: `env ${config.selectors.loginSubmit}` },
    { value: "#login-saml-button", label: "#login-saml-button" },
    { value: "button[type='submit']", label: "button submit" },
    { value: "input[type='submit']", label: "input submit" },
    { value: "Entrar", kind: "role", role: "button", exact: true, label: "button Entrar" },
    { value: "Entrar", kind: "text", exact: true, label: "texto Entrar" }
  ];
}

async function isAuthenticated(page) {
  appendSessionTrace("Verificando sessao autenticada");
  await page.goto(config.urls.process || config.urls.lancamento || config.urls.base, {
    waitUntil: "domcontentloaded"
  });

  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  return page.url().startsWith(config.urls.base) && !page.url().includes("fluigidentity.com");
}

async function performLogin(page) {
  appendSessionTrace("Iniciando login");
  await page.goto(config.urls.process || config.urls.lancamento || config.urls.login, {
    waitUntil: "domcontentloaded"
  });
  await waitUntilPageSettles(page, "login/cloudpass");
  appendSessionTrace(`URL de login atual: ${page.url()}`);

  const userInput = await findVisibleLocator(page, loginUserCandidates(), "Campo de usuario");
  await userInput.fill(config.credentials.username);

  const passwordInput = await findVisibleLocator(page, loginPasswordCandidates(), "Campo de senha");
  await passwordInput.fill(config.credentials.password);

  const submitButton = await findVisibleLocator(page, loginSubmitCandidates(), "Botao Entrar", 15000);
  await submitButton.click();
  await page.waitForURL((url) => url.href.startsWith(config.urls.base), { timeout: 60000 });
  await waitUntilPageSettles(page, "pos-login");
  appendSessionTrace("Login concluido");
}

async function loginWithBrowser({ headless = true } = {}) {
  appendSessionTrace("Abrindo browser");
  const browser = await chromium.launch({ headless, slowMo: config.browser.slowMo });
  const hasStoredAuth = fs.existsSync(config.authFile);
  appendSessionTrace(`Storage auth encontrado: ${hasStoredAuth ? "sim" : "nao"}`);
  let context = await browser.newContext(
    hasStoredAuth
      ? {
          storageState: config.authFile
        }
      : undefined
  );
  let page = await context.newPage();

  const authenticated = hasStoredAuth ? await isAuthenticated(page) : false;
  appendSessionTrace(`Sessao reutilizada valida: ${authenticated ? "sim" : "nao"}`);

  if (!authenticated) {
    await context.close();
    context = await browser.newContext();
    page = await context.newPage();
    await performLogin(page);
    await context.storageState({ path: config.authFile });
    appendSessionTrace("Storage auth atualizado");
  }

  return {
    browser,
    context,
    page,
    async close() {
      await context.close();
      await browser.close();
    }
  };
}

module.exports = {
  loginWithBrowser
};
