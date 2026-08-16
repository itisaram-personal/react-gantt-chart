#!/usr/bin/env node
/**
 * Publish every public package under `packages/` to npm, one at a time.
 *
 *   npm run publish-all-gantts
 *   npm run publish-all-gantts -- --dry-run
 *   npm run publish-all-gantts -- --otp=123456
 *
 * Anything after `--` is handed to each `npm publish` untouched.
 *
 * A package's `dist/` is deleted once it is on the registry, so a release leaves
 * no build output behind to be mistaken for a current one. Run `npm run build`
 * before anything that reads it again — typecheck resolves the packages through
 * `dist`, and dev needs it too.
 *
 * Each package is published from *inside its own directory* rather than with
 * `npm publish -w`, which is what `.github/workflows/release.yml` does and for
 * the same reason: the token npm mints for trusted publishing is scoped to the
 * package resolved from the working directory.
 *
 * Note this is `npm publish`, not `npm run publish` — no package defines a
 * script by that name, and `npm run` only runs scripts.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(root, "packages");
/*
 * How to invoke npm.
 *
 * Under `npm run`, npm hands over the path to its own CLI in `npm_execpath`:
 * running that with this Node is exact, and needs no shell. Run standalone
 * (`node scripts/publish-all-gantts.mjs`) there is nothing to point at, so fall
 * back to the `npm` on PATH — which on Windows is a .cmd shim, and since Node 20
 * a shim only spawns through a shell (CVE-2024-27980).
 */
const npmCli = process.env.npm_execpath;
const viaCli = Boolean(npmCli?.endsWith(".js"));
const npm = viaCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const npmArgs = viaCli ? [npmCli] : [];
const shell = !viaCli && process.platform === "win32";
const passThrough = process.argv.slice(2);
/** A dry run publishes nothing, so there is nothing to clean up after. */
const dryRun = passThrough.includes("--dry-run");

function manifestOf(dir) {
  try {
    return JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Dependency order: core before the packages that depend on it.
 *
 * Not a hard-coded list, so a new package joins the release by existing. A
 * consumer installing halfway through a release then never resolves a package
 * whose sibling is not on the registry yet.
 */
function inDependencyOrder(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const sorted = [];
  const done = new Set();

  const visit = (pkg, trail) => {
    if (done.has(pkg.name)) return;
    if (trail.includes(pkg.name)) {
      throw new Error(`dependency cycle: ${[...trail, pkg.name].join(" -> ")}`);
    }
    for (const dependency of Object.keys(pkg.dependencies)) {
      const local = byName.get(dependency);
      if (local) visit(local, [...trail, pkg.name]);
    }
    done.add(pkg.name);
    sorted.push(pkg);
  };

  for (const pkg of packages) visit(pkg, []);
  return sorted;
}

/**
 * Is this exact version on the registry already?
 *
 * Lets a re-run after a partial failure resume instead of stopping on npm's
 * "version already exists". A registry that cannot be reached answers no, and
 * the publish that follows reports the real problem.
 */
function alreadyPublished(name, version) {
  const result = spawnSync(npm, [...npmArgs, "view", `${name}@${version}`, "version"], {
    stdio: "ignore",
    shell,
  });
  return result.status === 0;
}

/**
 * Drop a package's build output, now that the registry has a copy of it.
 *
 * Only ever called for a package npm has just accepted, and only for its own
 * `dist` — a failure leaves the tree alone for whoever has to look at it. The
 * removal is never fatal either: the release has already happened by then, and
 * a file Windows will not let go of is not worth failing it over.
 */
function removeDist(pkg) {
  const dist = join(packagesDir, pkg.dir, "dist");
  if (!existsSync(dist)) return;
  try {
    rmSync(dist, { recursive: true, force: true });
    console.log(`  removed packages/${pkg.dir}/dist`);
  } catch (error) {
    console.warn(`  could not remove packages/${pkg.dir}/dist: ${error.message}`);
  }
}

const found = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ dir: entry.name, manifest: manifestOf(entry.name) }))
  .filter((entry) => entry.manifest?.name && entry.manifest?.version)
  .map(({ dir, manifest }) => ({
    dir,
    name: manifest.name,
    version: manifest.version,
    private: manifest.private === true,
    dependencies: manifest.dependencies ?? {},
  }));

if (found.length === 0) {
  console.error(`No packages found in ${packagesDir}.`);
  process.exit(1);
}

for (const pkg of found.filter((pkg) => pkg.private)) {
  console.log(`- ${pkg.name} is private, skipping`);
}

const queue = inDependencyOrder(found.filter((pkg) => !pkg.private));
console.log(`Publishing ${queue.length} package(s): ${queue.map((pkg) => pkg.name).join(", ")}\n`);

const published = [];
const skipped = [];

for (const pkg of queue) {
  const label = `${pkg.name}@${pkg.version}`;

  if (alreadyPublished(pkg.name, pkg.version)) {
    console.log(`- ${label} is already on the registry, skipping`);
    skipped.push(label);
    continue;
  }

  console.log(`\n> ${label}  (packages/${pkg.dir})`);
  const result = spawnSync(npm, [...npmArgs, "publish", ...passThrough], {
    cwd: join(packagesDir, pkg.dir),
    stdio: "inherit",
    shell,
  });

  if (result.error) {
    console.error(`\nCould not run npm: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n${label} failed to publish (${result.signal ?? `exit ${result.status}`}).`);
    if (published.length > 0) {
      console.error(`Published before it failed: ${published.join(", ")}.`);
      console.error("Fix the cause and re-run — published versions are skipped.");
    }
    process.exit(result.status ?? 1);
  }

  published.push(label);
  if (!dryRun) removeDist(pkg);
}

console.log(`\nDone. Published: ${published.join(", ") || "nothing"}.`);
if (skipped.length > 0) console.log(`Already on the registry: ${skipped.join(", ")}.`);
if (published.length > 0 && !dryRun) console.log("Run `npm run build` before using the workspace again.");
