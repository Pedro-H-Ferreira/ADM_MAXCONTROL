/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

function required(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`);
  }

  return value.trim();
}

function optional(name, fallback = "") {
  return (process.env[name] || fallback).trim();
}

function optionalBoolean(name, fallback) {
  const value = process.env[name];

  if (value == null || value === "") {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

function optionalNumber(name, fallback) {
  const value = process.env[name];

  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    throw new Error(`Variavel numerica invalida: ${name}`);
  }

  return parsed;
}

function buildUrl(baseUrl, route) {
  if (!route) {
    return baseUrl;
  }

  return new URL(route, baseUrl).toString();
}

function normalizeOriginUrl(value) {
  const raw = String(value || "").trim();
  const url = new URL(raw);
  return `${url.protocol}//${url.host}`;
}

function optionalUrl(name, fallback = "") {
  const value = optional(name, fallback);

  if (!value) {
    return "";
  }

  return value;
}

const projectRoot = path.resolve(__dirname, "..", "..");
loadEnvFile(path.join(projectRoot, ".env.local"));
loadEnvFile(path.join(projectRoot, ".env"));
const storageDir = path.resolve(optional("FLUIG_STORAGE_DIR", path.join(projectRoot, "storage")));
const authDir = path.resolve(optional("FLUIG_AUTH_DIR", path.join(storageDir, ".auth")));
const logsDir = path.resolve(optional("FLUIG_LOGS_DIR", path.join(projectRoot, "logs")));
const dataDir = path.join(__dirname, "data");
const dataFile = path.resolve(projectRoot, optional("LANCAMENTOS_FILE", "src/data/lancamentos.json"));
const authFile = path.join(authDir, "fluig.json");
const fluigBaseUrl = normalizeOriginUrl(required("FLUIG_BASE_URL"));

for (const dir of [storageDir, authDir, logsDir, dataDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = {
  projectRoot,
  logsDir,
  authFile,
  dataFile,
  browser: {
    headless: optionalBoolean("HEADLESS", true),
    slowMo: optionalNumber("SLOW_MO", 0)
  },
  urls: {
    base: fluigBaseUrl,
    login: buildUrl(fluigBaseUrl, required("FLUIG_LOGIN_PATH")),
    lancamento: buildUrl(fluigBaseUrl, required("FLUIG_LANCAMENTO_PATH")),
    launchpad: optionalUrl("FLUIG_LAUNCHPAD_URL"),
    home: optionalUrl("FLUIG_HOME_URL"),
    process: optionalUrl("FLUIG_PROCESS_URL")
  },
  credentials: {
    username: required("FLUIG_USERNAME"),
    password: required("FLUIG_PASSWORD")
  },
  selectors: {
    loginUser: required("LOGIN_USER_SELECTOR"),
    loginPassword: required("LOGIN_PASSWORD_SELECTOR"),
    loginSubmit: required("LOGIN_SUBMIT_SELECTOR"),
    postLoginReady: required("POST_LOGIN_READY_SELECTOR"),
    lancamentoFormReady: required("LANCAMENTO_FORM_READY_SELECTOR"),
    lancamentoSubmit: required("LANCAMENTO_SUBMIT_SELECTOR"),
    lancamentoSuccess: optional("LANCAMENTO_SUCCESS_SELECTOR"),
    lancamentoNewButton: optional("LANCAMENTO_NEW_BUTTON_SELECTOR"),
    fields: {
      colaborador: optional("CAMPO_COLABORADOR_SELECTOR"),
      empresa: optional("CAMPO_EMPRESA_SELECTOR"),
      data: optional("CAMPO_DATA_SELECTOR"),
      descricao: optional("CAMPO_DESCRICAO_SELECTOR"),
      valor: optional("CAMPO_VALOR_SELECTOR"),
      centroCusto: optional("CAMPO_CENTRO_CUSTO_SELECTOR")
    }
  }
};
