import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";

const basePath = "/smoke-legal-connect/";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a local test port."));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

const port = await freePort();
const env = Object.fromEntries(
  Object.entries({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    PNPM_HOME: process.env.PNPM_HOME,
    CI: "true",
    NODE_ENV: "development",
    PORT: String(port),
    BASE_PATH: basePath,
  }).filter(([, value]) => value !== undefined),
);
const server = spawn("pnpm", ["--filter", "@workspace/consult-lawyer", "run", "dev"], {
  env, stdio: ["ignore", "ignore", "pipe"], detached: true,
});
let stderr = "";
server.stderr.setEncoding("utf8").on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });

try {
  const url = `http://127.0.0.1:${port}${basePath}`;
  let response;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !server.killed) {
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      break;
    } catch {
      if (server.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  assert.ok(response, `Web client did not start on ${url}.\n${stderr}`);
  assert.equal(response.status, 200, `Web client returned HTTP ${response.status} for ${url}`);
  const html = await response.text();
  assert.match(html, /Consult with Lawyer/i, "Expected the application entry page.");
  assert.match(html, /\/smoke-legal-connect\/src\/main\.tsx/, "Vite entry must honor BASE_PATH.");
  console.log(`Web smoke test passed: ${url}`);
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    try { process.kill(-server.pid, "SIGTERM"); }
    catch { server.kill("SIGTERM"); }
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
}
