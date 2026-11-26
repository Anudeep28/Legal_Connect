import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";

const basePath = "/smoke-legal-connect/";
const appFilter = "@workspace/consult-lawyer";
const bookmarkedRoutes = [
  ["lawyers", "lawyer directory"],
  ["lawyers/smoke-lawyer-id", "lawyer profile"],
  ["dashboard", "client dashboard"],
  ["consultations/smoke-consultation-id", "consultation details"],
  ["documents/smoke-document-id", "document editor"],
  ["lawyer/profile", "lawyer profile editor"],
];

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

async function verifyDeepLinkResponses(baseUrl, label, checkHtml) {
  for (const [route, description] of bookmarkedRoutes) {
    const routeUrl = new URL(route, baseUrl);
    assert.ok(routeUrl.pathname.startsWith(basePath), `${description} escaped BASE_PATH: ${routeUrl.pathname}`);
    for (const navigation of ["direct navigation", "refresh"]) {
      const response = await fetch(routeUrl, {
        redirect: "manual",
        headers: { accept: "text/html", "cache-control": "no-cache" },
        signal: AbortSignal.timeout(5000),
      });
      const context = `${label} ${navigation} for ${routeUrl.pathname}`;
      assert.equal(response.status, 200, `${context} returned HTTP ${response.status}`);
      assert.equal(response.url, routeUrl.href, `${context} redirected outside its requested URL.`);
      assert.match(
        response.headers.get("content-type") ?? "",
        /text\/html/i,
        `${context} did not return the application HTML`,
      );
      const html = await response.text();
      assert.match(html, /<div\s+id=["']root["']/, `${context} did not return the React mount point.`);
      await checkHtml(html, routeUrl, description);
    }
  }
  console.log(`${label} deep-link smoke test passed: ${bookmarkedRoutes.length} lawyer/client routes stayed under ${basePath}`);
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
    const baseUrl = new URL(basePath, url);
    await verifyDeepLinkResponses(baseUrl, "Vite development server", async (routeHtml, routeUrl, description) => {
      assert.match(routeHtml, /Consult with Lawyer/i, `Expected the application entry page for ${description}.`);
      assert.match(
        routeHtml,
        /\/smoke-legal-connect\/src\/main\.tsx/,
        `Vite entry escaped BASE_PATH for ${description} at ${routeUrl.pathname}.`,
      );
    });
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

function extractHtmlReferences(html) {
  return [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map((match) => match[1]);
}

function extractCssReferences(css) {
  const urls = [...css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].map((match) => match[2].trim());
  const imports = [...css.matchAll(/@import\s*(?:url\(\s*)?(['"]?)(https?:\/\/[^"'\s;)]+)\1/gi)]
    .map((match) => match[2]);
  return [...urls, ...imports];
}

function inspectAssetReferences(references, baseUrl) {
  const fontStylesheets = [];
  const localAssets = new Map();
  for (const reference of references) {
    if (!reference || reference.startsWith("#") || reference.startsWith("data:")) continue;
    const assetUrl = new URL(reference, baseUrl);
    if (assetUrl.origin !== baseUrl.origin) {
      if (assetUrl.hostname === "fonts.googleapis.com") {
        assert.equal(assetUrl.protocol, "https:", `Font stylesheet must use HTTPS: ${assetUrl.href}`);
        fontStylesheets.push(assetUrl);
      }
      continue;
    }
    assert.ok(
      assetUrl.pathname.startsWith(basePath),
      `Local asset escaped BASE_PATH: ${assetUrl.pathname} (from ${reference})`,
    );
    if (/\.(?:svg|ico|png|jpe?g|webp|gif|woff2?|ttf|otf)$/i.test(assetUrl.pathname)) {
      localAssets.set(assetUrl.href, assetUrl);
    }
  }
  return { fontStylesheets, localAssets: [...localAssets.values()] };
}

async function listBuiltFiles(directory, subdirectory = "") {
  const entries = await readdir(path.join(directory, subdirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(subdirectory, entry.name);
    if (entry.isDirectory()) files.push(...await listBuiltFiles(directory, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

function assetType(pathname) {
  const extension = path.extname(pathname).toLowerCase();
  if (extension === ".svg") return /image\/svg\+xml/i;
  if (extension === ".ico") return /image\/(?:x-icon|vnd\.microsoft\.icon)/i;
  if (extension === ".png") return /image\/png/i;
  if (extension === ".jpg" || extension === ".jpeg") return /image\/jpeg/i;
  if (extension === ".webp") return /image\/webp/i;
  if (extension === ".gif") return /image\/gif/i;
  if (extension === ".woff2") return /font\/woff2|application\/font-woff/i;
  if (extension === ".woff") return /font\/woff|application\/font-woff/i;
  if (extension === ".ttf") return /font\/ttf|application\/x-font-ttf|application\/octet-stream/i;
  if (extension === ".otf") return /font\/otf|application\/vnd\.ms-opentype|application\/octet-stream/i;
  return null;
}

async function verifyAssetResponse(assetUrl, expectedContentType, description) {
  const response = await fetch(assetUrl, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `${description} returned HTTP ${response.status}: ${assetUrl.pathname}`);
  assert.match(
    response.headers.get("content-type") ?? "",
    expectedContentType,
    `${description} had an unexpected content type: ${assetUrl.pathname}`,
  );
  const contents = await response.arrayBuffer();
  assert.ok(contents.byteLength > 0, `${description} was empty: ${assetUrl.pathname}`);
}

async function verifyPublicAssets(html, cssAssets, baseUrl) {
  const inspectedHtml = inspectAssetReferences(extractHtmlReferences(html), baseUrl);
  const inspectedCss = cssAssets.map(({ url, css }) =>
    inspectAssetReferences(extractCssReferences(css), url));
  const builtFiles = await listBuiltFiles(
    path.resolve(import.meta.dirname, "..", "artifacts/consult-lawyer/dist/public"),
  );
  const publicFiles = builtFiles.filter((file) => !file.startsWith("assets/"));
  const imageFiles = publicFiles.filter((file) => /\.(?:png|jpe?g|webp|gif)$/i.test(file));
  const iconFiles = publicFiles.filter((file) => /\.(?:svg|ico)$/i.test(file));
  const fontFiles = publicFiles.filter((file) => /\.(?:woff2?|ttf|otf)$/i.test(file));
  assert.ok(imageFiles.length > 0, "Production build must include a public image to verify under BASE_PATH.");
  assert.ok(iconFiles.length > 0, "Production build must include a public icon to verify under BASE_PATH.");
  assert.ok(
    fontFiles.length > 0 || inspectedHtml.fontStylesheets.length > 0 ||
      inspectedCss.some(({ fontStylesheets }) => fontStylesheets.length > 0),
    "Production build must include a local font or an HTTPS font stylesheet reference.",
  );

  const assetsToCheck = new Map();
  for (const assetUrl of [
    ...inspectedHtml.localAssets,
    ...inspectedCss.flatMap(({ localAssets }) => localAssets),
  ]) {
    const type = assetType(assetUrl.pathname);
    if (type) assetsToCheck.set(assetUrl.href, { assetUrl, type, description: "Referenced public asset" });
  }
  for (const file of [...imageFiles, ...iconFiles, ...fontFiles]) {
    const type = assetType(file);
    if (!type) continue;
    const assetUrl = new URL(file, baseUrl);
    assert.ok(assetUrl.pathname.startsWith(basePath), `Public asset escaped BASE_PATH: ${assetUrl.pathname}`);
    assetsToCheck.set(assetUrl.href, {
      assetUrl,
      type,
      description: file.match(/\.(?:woff2?|ttf|otf)$/i) ? "Public font" :
        file.match(/\.(?:svg|ico)$/i) ? "Public icon" : "Public image",
    });
  }
  for (const { assetUrl, type, description } of assetsToCheck.values()) {
    await verifyAssetResponse(assetUrl, type, description);
  }
  console.log(
    `Production public assets passed: ${imageFiles.length} images, ${iconFiles.length} icons, ` +
    `${fontFiles.length} local fonts and ${inspectedHtml.fontStylesheets.length + inspectedCss.reduce((count, { fontStylesheets }) => count + fontStylesheets.length, 0)} HTTPS font stylesheets.`,
  );
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
    const stylesheets = [];
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
      if (/\.css$/i.test(assetUrl.pathname)) {
        stylesheets.push({ url: assetUrl, css: new TextDecoder().decode(contents) });
      }
    }
    await verifyPublicAssets(html, stylesheets, url);
    await verifyDeepLinkResponses(
      new URL(basePath, url),
      "Vite production preview",
      async (routeHtml, routeUrl, description) => {
        assert.match(routeHtml, /Consult with Lawyer/i, `Expected the built application entry page for ${description}.`);
        const routeAssets = getBuiltAssets(routeHtml, routeUrl);
        assert.deepEqual(
          routeAssets.map(([assetUrl]) => assetUrl.href),
          assets.map(([assetUrl]) => assetUrl.href),
          `Built assets differed for ${description} at ${routeUrl.pathname}.`,
        );
      },
    );
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
