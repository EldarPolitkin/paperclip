import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeSanitizedJson } from "./sanitized-json-writer.js";
import { bindInvitationEvidenceWriter, declareSelectedInvitationEvidence, INVITATION_PRIVATE_EXECUTION } from "./invitation-private-capability.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(secrets: string[] = []) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "invitation-writer-")); roots.push(directory);
  const scope = declareSelectedInvitationEvidence(INVITATION_PRIVATE_EXECUTION, 1, "a".repeat(40))!;
  bindInvitationEvidenceWriter(scope, secrets);
  return { directory, secrets };
}
it.each(["raw", "url", "base64", "shape"])("actual captured-JSON writer rejects %s before sanitizer", async kind => {
  const secret = "synthetic-private-root/+1234567890", f = await fixture([secret]);
  const value = kind === "raw" ? secret : kind === "url" ? encodeURIComponent(secret)
    : kind === "base64" ? Buffer.from(secret).toString("base64") : "sk-proj-syntheticUnknownCredential123456789";
  await expect(writeSanitizedJson(f.directory, "state.json", { token: value }, f.secrets)).rejects.toThrow(/Secret leak/);
  await expect(readFile(path.join(f.directory, "state.json"))).rejects.toThrow();
});
it("keeps genuine standard captured JSON, including private opaque evidence, without optional capability projection", async () => {
  const f = await fixture();
  const capability = `http://127.0.0.1/invite/pcp_invite_${"a".repeat(43)}`;
  const value = { comments: [{ body: capability }], runEvidence: [{ events: [{ payload: { text: capability } }] }] };
  await writeSanitizedJson(f.directory, "api-state.json", value, f.secrets);
  expect(JSON.parse(await readFile(path.join(f.directory, "api-state.json"), "utf8"))).toEqual(value);
});
it("new genuine roots remain protected after declaration rather than subtracting a public capability", async () => {
  const f = await fixture(); const token = `pcp_invite_${"b".repeat(43)}`;
  f.secrets.push(token);
  await expect(writeSanitizedJson(f.directory, "state.json", { body: `/invite/${token}` }, f.secrets)).rejects.toThrow(/Secret leak/);
});
it("retains ordinary nonselected captured-JSON sanitization", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ordinary-writer-")); roots.push(directory);
  const value = { data: "sk-proj-syntheticUnknownCredential123456789" };
  await writeSanitizedJson(directory, "state.json", value, []);
  expect(await readFile(path.join(directory, "state.json"), "utf8")).not.toContain(value.data);
  expect(declareSelectedInvitationEvidence("chat-features.runner-opencode.local.access.other-company", 1, "a".repeat(40))).toBeUndefined();
});
it("does not write after its existing abort signal expires", async () => {
  const f = await fixture();
  await expect(writeSanitizedJson(f.directory, "state.json", {}, f.secrets, AbortSignal.abort())).rejects.toThrow();
  await expect(readFile(path.join(f.directory, "state.json"))).rejects.toThrow();
});
