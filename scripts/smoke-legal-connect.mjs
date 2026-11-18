import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";

const basePath = "/smoke-legal-connect/";
const appFilter = "@workspace/consult-lawyer";

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

function smokeEnv(port, mode) {
  return Object.fromEntries(
    Object.entries({
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      PNPM_HOME: process.env.PNPM_HOME,
      CI: "true",
      NODE_ENV: mode,
      PORT: String(port),
      BASE_PATH: basePath,
    }).filter(([, value]) => value !== undefined),
  );
}

function launch(args, env) {
  const child = spawn("pnpm", args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8").on("data", (chunk) => { output = (output + chunk).slice(-6000); });
  }
  return { child, getOutput: () => output };
}

function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return Promise.resolve();
  try { process.kill(-child.pid, "SIGTERM"); }
  catch { child.kill("SIGTERM"); }
  return Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]).then(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch { child.kill("SIGKILL"); }
    }
  });
}

async function waitForServer(processRef, url, label) {
  let response;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && processRef.child.exitCode === null) {
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  assert.ok(response, `${label} did not start on ${url}.\n${processRef.getOutput()}`);
  assert.equal(response.status, 200, `${label} returned HTTP ${response.status} for ${url}`);
  return response;
}

async function verifyDevelopmentEntry() {
  const port = await freePort();
  const dev = launch(["--filter", appFilter, "run", "dev"], smokeEnv(port, "development"));
  try {
    const url = `http://127.0.0.1:${port}${basePath}`;
    const response = await waitForServer(dev, url, "Vite development server");
    const html = await response.text();
    assert.match(html, /Consult with Lawyer/i, "Expected the application entry page.");
    assert.match(html, /\/smoke-legal-connect\/src\/main\.tsx/, "Vite entry must honor BASE_PATH.");
    console.log(`Development smoke test passed: ${url}`);
  } finally {
    await stop(dev.child);
  }
}

function getBuiltAssets(html, origin) {
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .map((reference) => new URL(reference, origin))
    .filter((url) => url.origin === origin.origin && url.pathname.startsWith(`${basePath}assets/`));
  const unique = [...new Map(references.map((url) => [url.href, url])).values()];
  const javascript = unique.filter((url) => /\.m?js$/i.test(url.pathname));
  const stylesheets = unique.filter((url) => /\.css$/i.test(url.pathname));
  assert.ok(javascript.length > 0, "Production HTML must reference a bundled JavaScript asset under BASE_PATH.");
  assert.ok(stylesheets.length > 0, "Production HTML must reference a bundled CSS asset under BASE_PATH.");
  return [...javascript.map((url) => [url, /javascript|ecmascript/i]), ...stylesheets.map((url) => [url, /text\/css/i])];
}

async function verifyProductionAssets() {
  const buildPort = await freePort();
  const build = launch(
    ["--filter", appFilter, "run", "build"],
    smokeEnv(buildPort, "production"),
  );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(async () => {
      await stop(build.child);
      reject(new Error(`Production build timed out.\n${build.getOutput()}`));
    }, 120_000);
    build.child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    build.child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Production build failed (${signal ?? code}).\n${build.getOutput()}`));
    });
  });

  const port = await freePort();
  const preview = launch(
    ["--filter", appFilter, "run", "preview:smoke"],
    smokeEnv(port, "production"),
  );
  try {
    const url = new URL(`${basePath}`, `http://127.0.0.1:${port}`);
    const response = await waitForServer(preview, url.href, "Vite production preview");
    const html = await response.text();
    assert.match(html, /Consult with Lawyer/i, "Expected the built application entry page.");
    const assets = getBuiltAssets(html, url);
    for (const [assetUrl, contentTypePattern] of assets) {
      const assetResponse = await fetch(assetUrl, { signal: AbortSignal.timeout(5000) });
      assert.equal(assetResponse.status, 200, `Built asset returned HTTP ${assetResponse.status}: ${assetUrl.pathname}`);
      assert.match(
        assetResponse.headers.get("content-type") ?? "",
        contentTypePattern,
        `Built asset had an unexpected content type: ${assetUrl.pathname}`,
      );
      const contents = await assetResponse.arrayBuffer();
      assert.ok(contents.byteLength > 0, `Built asset was empty: ${assetUrl.pathname}`);
    }
    console.log(`Production smoke test passed: ${assets.length} bundled JS/CSS assets loaded under ${basePath}`);
  } finally {
    await stop(preview.child);
  }
}

try {
  await verifyDevelopmentEntry();
  await verifyProductionAssets();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
