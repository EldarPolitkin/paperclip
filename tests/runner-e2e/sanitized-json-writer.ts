import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSecretFree, findSecretLeakInJsonValues, sanitizeJson } from "./redaction.js";
import { assertBoundInvitationWriterEvidence } from "./invitation-private-capability.js";

export async function writeSanitizedJson(
  directory: string,
  name: string,
  value: unknown,
  secrets: readonly string[],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  assertBoundInvitationWriterEvidence(name, value, secrets);
  const raw = `${JSON.stringify(value)}\n`;
  // Public API payloads may contain harmless provider-shaped fixtures or
  // opaque generated tokens. Reject exact campaign credentials before writing,
  // then sanitize all known shapes and assert the published JSON is clean.
  assertSecretFree(raw, secrets, name, { includeShapes: false });
  const safe = `${JSON.stringify(sanitizeJson(value, secrets), null, 2)}\n`;
  const leak = findSecretLeakInJsonValues(JSON.parse(safe), secrets);
  if (leak) throw new Error(`Secret leak in ${name}: ${leak}`);
  signal?.throwIfAborted();
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), safe, { encoding: "utf8", signal });
}

