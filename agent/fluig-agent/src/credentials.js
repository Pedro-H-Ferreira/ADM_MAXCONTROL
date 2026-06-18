const { execFileSync } = require("node:child_process");
const path = require("node:path");

function readCredentials(config) {
  const envUsername = String(process.env.FLUIG_USERNAME || "").trim();
  const envPassword = String(process.env.FLUIG_PASSWORD || "").trim();
  if (envUsername && envPassword) {
    return {
      username: envUsername,
      password: envPassword,
    };
  }

  const scriptPath = path.resolve(__dirname, "..", "scripts", "read-credential.ps1");
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-ConfigDir", config.configDir],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const parsed = JSON.parse(output);
  const username = String(parsed.username || "").trim();
  const password = String(parsed.password || "").trim();

  if (!username || !password) {
    throw new Error("Credenciais Fluig locais nao configuradas para este usuario do Windows.");
  }

  return { username, password };
}

module.exports = {
  readCredentials,
};
