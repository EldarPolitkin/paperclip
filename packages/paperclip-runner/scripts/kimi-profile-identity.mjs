import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const KIMI_PROFILE_VERSION = 11;
const sources = [
  "scripts/patch-kimi-runtime.mjs", "scripts/kimi-instructions-runtime.mjs",
  "scripts/materialize-kimi-distribution.mjs", "scripts/provision-kimi.mjs",
  "scripts/kimi-distribution/package.json", "scripts/kimi-distribution/package-lock.json",
  "src/drivers/acpx/kimi-closure-pins.ts", "src/drivers/acpx/kimi-config.ts",
  "src/drivers/acpx/kimi-installation.ts", "src/drivers/acpx/kimi-instructions.ts",
  "src/drivers/acpx/instruction-admission.ts", "src/drivers/acpx/kimi-runtime-files.ts",
  "src/configured-environment.ts", "src/drivers/acpx/environment.ts",
  "src/drivers/acpx/codex-runtime-adapter.ts", "src/drivers/acpx/runtime-host.ts",
  "src/drivers/acpx/runtime-sandbox.ts", "src/cli/acpx-runtime-sidecar.ts",
  "scripts/build-verified-provider-entrypoints.mjs",
  "src/drivers/acpx/kimi-models.ts", "src/drivers/acpx/kimi-metadata-probe.ts",
  "src/cli/kimi-metadata-probe.ts", "src/drivers/acpx/kimi-message-boundary.ts",
  "src/drivers/acpx/codex-acpx-driver.ts", "src/drivers/acpx/sidecar-protocol.ts",
  "src/drivers/acpx/acp-edit-context.ts", "src/drivers/acpx/acp-permission-adapter.ts",
  "src/drivers/acpx/safe-locations.ts", "src/drivers/acpx/generated-sidecar-contract.ts",
  "src/semantic-tools/redaction.ts",
  "runner/crates/runner-core/src/acpx_provider_state.rs",
];
const canonical = value => value && typeof value === "object"
  ? Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  : JSON.stringify(value);
const sha = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function kimiProfileIdentity(root = packageRoot) {
  const manifest = JSON.parse(readFileSync(resolve(root, "acpx-profiles.json"), "utf8"));
  const { commandDigest: _digest, ...profile } = manifest.profiles.kimi;
  const declaration = {
    schema: "paperclip.kimi-profile-identity.v1", agent: "kimi", ...profile,
    agentProfileVersion: KIMI_PROFILE_VERSION, acpxVersion: manifest.acpxVersion,
    sources: Object.fromEntries(sources.map(path => [path, sha(readFileSync(resolve(root, path)))])),
  };
  return { declaration, commandDigest: sha(canonical(declaration)) };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const identity = kimiProfileIdentity();
  const manifestPath = resolve(packageRoot, "acpx-profiles.json");
  const fixturePath = resolve(packageRoot, `test/fixtures/kimi-profile-v${KIMI_PROFILE_VERSION}-identity.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (process.argv.includes("--check")) {
    assert.deepEqual(JSON.parse(readFileSync(fixturePath, "utf8")), identity, "Kimi source identity is stale");
    assert.equal(manifest.profiles.kimi.commandDigest, identity.commandDigest);
    assert.equal(manifest.profiles.kimi.agentProfileVersion, KIMI_PROFILE_VERSION);
  } else {
    if (existsSync(fixturePath) && canonical(JSON.parse(readFileSync(fixturePath, "utf8"))) !== canonical(identity)) throw new Error("Kimi profile identity is immutable; advance KIMI_PROFILE_VERSION before changing its bound source");
    manifest.profiles.kimi.commandDigest = identity.commandDigest;
    manifest.profiles.kimi.agentProfileVersion = KIMI_PROFILE_VERSION;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(fixturePath, `${JSON.stringify(identity, null, 2)}\n`);
  }
}
