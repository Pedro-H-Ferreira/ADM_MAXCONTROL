const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const configDir = process.env.ADM_FLUIG_AGENT_CONFIG_DIR || path.join(appData, "ADM MaxControl", "fluig-agent");
const configFile = process.env.ADM_FLUIG_AGENT_CONFIG || path.join(configDir, "config.json");

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").replace(/^ï»¿/, ""));
}

function optional(config, key, fallback = "") {
  return String(process.env[key] || config[key] || fallback).trim();
}

function normalizeOriginUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return raw.replace(/\/$/, "");
  }
}

function buildConfig() {
  const fileConfig = readJson(configFile);
  const projectRoot = optional(
    fileConfig,
    "ADM_PROJECT_ROOT",
    path.resolve(__dirname, "..", "..", "..")
  );
  const fluigBaseUrl = normalizeOriginUrl(optional(fileConfig, "FLUIG_BASE_URL"));

  return {
    configDir,
    configFile,
    projectRoot,
    apiUrl: optional(fileConfig, "ADM_API_URL", "https://adm-maxcontrol.vercel.app").replace(/\/$/, ""),
    token: optional(fileConfig, "ADM_AGENT_TOKEN"),
    localPort: Number(optional(fileConfig, "LOCAL_AGENT_PORT", "4777")),
    pollIntervalMs: Number(optional(fileConfig, "POLL_INTERVAL_MS", "3000")),
    agentVersion: optional(fileConfig, "AGENT_VERSION", "0.1.0"),
    machineName: optional(fileConfig, "MACHINE_NAME", os.hostname()),
    machineId: optional(fileConfig, "MACHINE_ID", `${os.hostname()}-${os.userInfo().username}`),
    fluig: {
      baseUrl: fluigBaseUrl,
      loginPath: optional(fileConfig, "FLUIG_LOGIN_PATH"),
      lancamentoPath: optional(fileConfig, "FLUIG_LANCAMENTO_PATH"),
      processUrl: optional(fileConfig, "FLUIG_PROCESS_URL"),
      taskUserId: optional(fileConfig, "FLUIG_TASK_USER_ID", "00130"),
      headless: optional(fileConfig, "HEADLESS", "true"),
      slowMo: optional(fileConfig, "SLOW_MO", "0"),
      selectors: {
        loginUser: optional(fileConfig, "LOGIN_USER_SELECTOR", "#username"),
        loginPassword: optional(fileConfig, "LOGIN_PASSWORD_SELECTOR", "#password"),
        loginSubmit: optional(fileConfig, "LOGIN_SUBMIT_SELECTOR", "#login-saml-button"),
        postLoginReady: optional(fileConfig, "POST_LOGIN_READY_SELECTOR", "#desktop"),
        lancamentoFormReady: optional(fileConfig, "LANCAMENTO_FORM_READY_SELECTOR", "body"),
        lancamentoSubmit: optional(fileConfig, "LANCAMENTO_SUBMIT_SELECTOR", "button[type=\"submit\"]"),
      },
    },
  };
}

module.exports = {
  buildConfig,
};
