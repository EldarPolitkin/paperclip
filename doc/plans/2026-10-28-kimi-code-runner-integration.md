# Kimi Code native Runner integration — 2026-10-28

Owner: this chat, with separate provider, distribution, and product owners.
Baseline: `dce004259394486f6361d0c0dd5a33a5272acc0a`.
Branch: `codex/kimi-code-runner` in the existing managed worktree.
Delivery: tested, reviewable PR stack: Runner foundation, then product setup and
acceptance. Each slice must compile and remain below the repository review limit.
Merge, publication, and production deployment
are separate from this handoff. The user confirmed local plus Daytona acceptance.

## Release contract

An operator selects Kimi Code in native Runner, saves and reopens its exact
model/environment configuration, tests the runtime, assigns ordinary work, sees
streamed tools and output, receives independently verified files/artifacts and
durable task completion, and can Stop owned work. Existing legacy Kimi agents
and their history retain their current execution path.

- First environment: isolated local macOS arm64; remote: Daytona Linux x64.
- Runtime under investigation: official `@moonshot-ai/kimi-code@2.3.3`, ACP over
  stdio, behind the existing ACPX driver. The ambient Mac binary is 0.41.0 and
  cannot establish the new runtime's compatibility.
- Model: explicit caller-selected identifier, acknowledged before the first
  prompt. Qualification uses authenticated `kimi-for-coding`;
  discovery is never a product allowlist.
- Authentication: explicit company-secret `KIMI_API_KEY` environment binding.
  Qualification uses only the active global login's short-lived access token;
  the provider accepted a real model/tool turn. Refresh tokens and login homes
  are never transferred. Managed Kimi account connections are deferred.
- Instructions: exact composed content must reach native model instructions on
  create and load, with correlated acknowledgment; missing proof rejects prompt
  admission. Current official ACP does not consume this field, so a pinned,
  provider-owned runtime patch is required unless a richer interface proves better.
- Required: model/instruction admission, scoped authenticated tools, streaming,
  semantic questions, permission decisions, cancellation, session continuation,
  terminal settlement, cleanup, clean installation, and the ordinary product path.
  Native question/plan controls are inventoried separately before any claim.
- Deferred unless separately qualified: managed browser login, active steering,
  inbound media, native question/plan controls, native child/background agents,
  first-class child projections, additional OS/architectures, and usage accounting.
  Native ACP reports context occupancy, not usable per-run token/cost totals.
  Dollar budget enforcement is therefore not a qualified capability.
- Spending: proportionate goal-authorized test/provider/infrastructure work;
  record material costs and unknowns, diagnose first divergence before paid retry,
  stop uninformative attempts. No recurring infrastructure commitment.

## Architecture and ownership

Provider translation and native patch remain Kimi-owned. Shared Runner supervision,
PRP transport, durable decisions, authorization, and task finalization retain
their existing contracts. Distribution is a pinned installed closure with no
fallback to ambient Kimi. Runtime admission remains pending until required live
qualification passes. Provider registration does not migrate legacy agents.

## Acceptance ledger

| Required gate | Environment | Observation | Verdict |
| --- | --- | --- | --- |
| Exact model and instructions | local and Daytona | Profile9 installed native create/load/model acknowledgments passed on both platforms; final authenticated product matrix remains incomplete | partial |
| Scoped tools and credentials | local and Daytona | Native v6 controlled peer, isolated installed runtime, and real local pending Write passed; no ambient credential fallback | partial |
| Ordinary setup | local and Daytona | Save/reopen/Test/run/reconnect and assigned skill still required; isolated hosted target now requested | unattempted |
| Useful task | local and Daytona | Profile9 local exact reply, accepted completion, workspace bytes and downloaded artifact bytes passed; authenticated Daytona remains blocked | partial |
| Human input and Stop | local and Daytona | Profile9 local Stop, native child loss, semantic answers and plan revision passed with durable decisions and cleanup; Daytona remains | partial |
| Continuation and child loss | local and Daytona | All local restart, question recovery, native loss and Stop/follow-up cases passed; Daytona remains | partial |
| Installed distribution | macOS arm64 and Linux x64 | Profile9 eighteen public tarballs, fresh installed CLI setup/offline reuse, immutable Linux image and native real-Daytona smoke passed | passed |
| Regression and repository checks | candidate revision | Typecheck/build and both current PR CI suites passed; local full-suite failure and its separate successful three-case reproduction remain recorded | partial |

Current totals: 1 fully passed, 6 partial, 1 unattempted of 8 gates.
These are profile9 results; a later promotion requires its own artifact checks.
Each gate's detailed cells and attempts will be recorded before qualification;
these grouped gates are not a substitute for per-environment passing evidence.

The explicit-only `kimi-qualification` Product E2E suite has 20 required cells:
message-marker, plan-revise-accept, ask-question, structured-question-resume,
structured-question-restart-resume, file-edit-validate, continuity-restart, and
stop-new-resume, native pending-permission Stop, and native pending-permission worker loss, each on local and Daytona. Each has one required repetition and
zero automatic paid retries. All ten local cells passed with report packaging and
cleanup. Stop retains source `821256d6`, campaign
`local-2026-10-29T14-46-04-979Z`, run `91557abb-b9c0-422d-af1e-f0e82e948e96`.
The other nine retain source `f7ac439e` and their individual campaigns between
15:10 and 15:33 UTC. The qualification-only observer correction leaves all native
runtime/profile/image inputs unchanged. It reads argc-bounded kernel argv while
retaining exact compiled-loader hashes, sealed native bytes, inode, ancestry and
run identity; a real compiled native/ACPX peer proved title mutation, excluded
an environment canary, rejected foreign/ambiguous targets and retired the child.
All ten original result hashes were independently checked. The four earlier local
failures remain unchanged alongside their later diagnoses and cleanup receipts.

Daytona has zero passing authenticated cells. Its first launch stopped at
admission because two executable digests were missing; no task or sandbox was
created. With the exact image Node/runnerd digests supplied, the first actual
Stop cell failed before provider startup: setup Test could not reach the global
Kimi catalog. Its failed/cleanup-failed grade is preserved. Six archived Test
sandboxes were subsequently ownership-verified, deleted and checked absent404;
that post-failure recovery does not change the original grade.

Assigned-skill behavior and ordinary connect/save/reopen/Test/run/reconnect remain
separate requirements, including the requested hosted test workspace.

## Current state

As of 2026-10-29, Kimi9 remains pending and hidden from ordinary selection. Its
command digest is `sha256:c42fa5361d53081a8bb497c35e1ee2f85e6c26d2e0d59fad14b93d16f810796b`,
with native patch v6 and unchanged macOS/Linux closures. Dependent profiles are
Pi34, Grok13 and Copilot81. Published master history takes precedence over
conflicting unmerged candidate variants; original candidate bytes and commits
remain on preserved backup refs.

The foundation PR #18028 at `08a5516b` and product PR #18029 at `6123a67a`
had green CI at those heads. The product review was Greptile 5/5 with one
actionable report configuration load-order comment. That comment is addressed
in the subsequent harness repair; fresh-head CI/review remain required. Both
PRs remain draft because real acceptance is incomplete. Full typecheck and build passed. The
local full test command failed three AI-connection cases after a first 15-second
timeout, then accumulated an idle-transaction/TRUNCATE wait chain in the unchanged
Git-expiration suite. The three connection cases passed separately without
source changes. The full command was interrupted after recording the lock chain;
all owned processes and its database port were independently verified stopped.
This is not a full local test pass or an established explanation of every failure.

Recovery and re-evidence on 2026-10-29:

- The previous checkout and its worktree registration disappeared. The cause is
  unknown. Pushed source was restored into a newly attached managed worktree;
  frozen dependency installation and the full build passed again. Historical
  local pass logs and all ten audited result hashes survived, but the original
  raw report packages did not. Those passes are not reconstructed from logs or
  synthetic calibration evidence.
- Commit `6123a67a` adds an explicit absolute report-root override with unchanged
  default storage, physical output containment, and traversal/symlink rejection.
  Actual final publication was checked across checkout removal, early failure,
  redaction, and missing mandatory evidence. The repair passed 123 focused
  evidence tests, seven sentinel tests, harness typecheck, actual CLI admission
  checks, and independent outside-sentinel preservation. These are harness
  controls, not provider acceptance.
- All ten fresh local profile9 cells passed at exact `6123a67a`, including final
  packaging and cleanup. Their original packages now live outside the checkout.
  Independent collection rehashed all 221 files without mismatch; each owned
  server and embedded database stopped and each temporary data root was absent.
  The 19 retained run records are not a model-call count.
- An independent temporary Cloud TEST credential reached the global Kimi endpoint
  and the exact installed Linux9 runtime passed native startup. The first
  controller attempt then failed before any test body: a Promise resolver
  shadowed the path resolver during event validation. The original failed and
  cleanup-failed grade remains. Credential-free actual-event replay reproduced
  the error and verified the correction. Empty JUnit suites, retained Playwright
  events, and source readiness gates establish that product fixture allocation
  and provider admission were never reached. Owned processes/ports were absent;
  the independent preflight sandbox was deleted and checked404, and the temporary
  credential was revoked and checked absent.
- The corrected controller reached the actual first Daytona cell. That attempt
  failed closed at `remote_native_fixture:lease_metadata`: its fixture selected a
  reusable warm environment, while the native lifecycle observer requires an
  isolated non-reusable lease. The observer guard is retained. Both observed
  owned sandboxes were separately deleted and checked404; its temporary credential
  was revoked and checked absent. The original failed and cleanup-failed grade
  remains; model usage is unavailable. A narrow fixture-producer correction and
  fresh Daytona acceptance are required before qualification.

The follow-up harness repair at `d5fc5c42` changes only the two remote native
lifecycle fixture configurations to isolated non-reusable leases. The eight
other Daytona cases remain warm and all ten local execution inputs are
unchanged. This per-case override is included in the suite fingerprint. The real
fixture-producer regression first failed both lifecycle cases, then passed with
three unchanged controls. The strict remote observer is unchanged. The same
repair loads the normal campaign report setting from its local environment file
after admission, with a credential-free actual-launch red/green regression;
listing and installed-startup admission retain their prior behavior. Focused
catalog/producer/observer/storage checks passed 227 tests with one existing skip,
and harness typecheck passed. Native profile9, vendor closures and image inputs
are unchanged; retain the fresh local evidence at `6123a67a` and pin a fresh
Daytona campaign to the repaired source rather than relabeling old attempts.

Material local attempts remain distinct:

- The first profile9 Stop attempt failed its outdated final UI oracle. Inspection
  also found duplicated partial assistant text; the provider-neutral consumer now
  respects the existing nested progress marker. Its retained event regression
  demonstrated red then green.
- A later Stop passed all behavior/cleanup checks but failed report packaging:
  custom screenshot filenames did not satisfy the existing `final-state.png`
  contract. Two capture names were corrected, with positive and missing-final
  packager checks. The original grade remains failed.
- One replacement failed before provider admission because two of its three
  credential-home quorum ports belonged to unrelated listeners dating from
  October 4 and 21. The guard correctly refused ownership. Foreign processes
  were untouched, and separate scoped cleanup verified our processes retired.
- The next local Stop passed behavior, report evidence and physical cleanup in
  33.8 seconds. The following provider-loss attempt reached an unanswered Write
  but refused fault injection: macOS `ps` renders loader bytes differently from
  the pinned argv. An unpaid real guarded-native probe reproduced that exact
  hash divergence. The corrected observer reads argc-bounded argv with those exact byte and
  ownership checks retained; the subsequent real loss cell passed.

Profile9 distribution proof now covers eighteen actual public-layout tarballs,
a clean scripts-disabled consumer, fresh installed CLI setup through the admitted
Node/npm proxy, network-denied reuse, unchanged lockfile and installed native ACP
create/load/model/EOF. No developer login home, refresh token, private database
override or model prompt was used for that packaging proof.

The native Linux image was built from frozen source `5f4c9edc`; later source
changes affect UI and test observers, with image inputs unchanged. An initial
export timed out after image construction and saved no smoke proof. The corrected
job `14af59a4-93be-4f83-990e-e308625ab1cc` completed in 9m40s with timestamped
stages, independently saved native smoke proof and a streaming compressed export.
Image ID is `sha256:139869415cdd7c7cd2a59f21626b8bdbbe0088f17209abf8cdda4f6a80b99718`;
content identity is `4560ebf62a9640e43aff893b1a6dd497746eeb2787732818b62acd911cdb0b7b`.
Create/load instruction acknowledgments and bounded EOF passed without prompts or
credentials. Local collection verified the full archive, source, profile,
closure, pack and daemon hashes. Its published immutable reference is
`public.ecr.aws/q2k8x0v0/paperclip/kimi-qualification-eed3@sha256:bad9994dadf1a55743dabed3cd3f785210131938d4407c8b0ca92a30a922c177`.
A real credential-free Daytona import/native smoke passed in 122.4 seconds on
Linux x64 with 4 CPU, 4 GiB memory and 10 GiB disk, then its exact sandbox was
deleted and checked404. It verified native create/load/model/instruction/EOF
boundaries without a model prompt. No authenticated Daytona task has passed. All
build failures are retained; the rejected IAM expansion
was never applied and no operator/provider token was sent to CodeBuild.

The user additionally requested hosted verification and confirmed an isolated
workspace at `https://kimi.test.paperclip.app`. It was created through the normal
Cloud UI under the existing authorized owner; the shared QA identity lease was
left untouched. It is active and empty on verified Core
`f8484a9f8d1f68e9534fee4f29e00e716dc680f4`, distribution `cloud-40777791731-1`,
not the Kimi build. A singleton TEST campaign enabled Native Runner on only this
workspace with matching applied/desired hashes; fleet defaults stayed unchanged.
Use the maintained Core preview deployment for this unmerged branch, record its
exact serving SHA/image, and qualify the Kimi user journey there. This does not
certify the private Cloud UI composition. No production or fleet-default change
is in scope.

The active remote blocker is now narrowed by independent controls. The same fresh
selected credential verifies through the host catalog path, while the actual
remote metadata helper returns `KIMI_PROVIDER_ERROR`. Installed helper/Node bytes,
profile admission and key/model forwarding match the expected boundary. A fixed
remote GET failed with `ECONNRESET` before HTTP, with sandbox blocking false and
no allowlists. Credential-free controls also reset for example.com, including
direct IPv4 curl, with no proxy variables present. All three diagnostic sandboxes
were destroyed and checked404. No TLS protection was weakened, endpoint switched
or inference attempted during those diagnostics.

[Daytona's current network policy](https://www.daytona.io/docs/en/network-limits/)
says Tier1/2 organization restrictions override sandbox settings. Its essential
service list includes `*.kimi.com` and `*.moonshot.ai`, but not the selected
account's official global `api.kimi.ai` endpoint. This is consistent with the
observations, not a confirmed cause: this key cannot read its organization policy
(HTTP401). It advertises only the public US target. The user was asked to confirm
full egress or another suitable test credential, while the existing TEST Cloud
provider setup is being checked. The global account must not be routed to the
separate CN endpoint as a workaround.

Critical path: establish legitimate Daytona egress to the global Kimi endpoint,
then run ten authenticated Daytona cells. Only after native qualification should
a new immutable profile promote ordinary admission/default packaging, with final
installed artifact/image checks and ordinary setup/assigned skills. Deploy the
exact candidate to the isolated test workspace, complete its hosted journey, and
finish the PR stack. A promotion patch has been prepared and tested only in TEMP;
it is not applied and does not count as qualification.

## Evidence and first divergences

- Frozen root dependency installation passed with the normal network-enabled
  package manager. Restricted-network signature fetch failures were retained;
  no signature gate was disabled.
- Runner TypeScript/Rust typecheck passed before final sidecar registration edits.
  Focused Runner contracts: 297 tests passed. Product setup/admission, token,
  catalog, and route checks have separate passing results; these are not live proof.
- Both locked runtime closures built in 8.4 seconds with 33 required npm packages.
  macOS arm64 installed native metadata and Linux x64 metadata under emulation
  passed create/model/load/EOF; Linux emulation is not Daytona qualification.
- Real bundled ACPX manager admitted exact `kimi-for-coding` and current bound
  instructions with physical cleanup. The first two attempted turns failed before
  semantic tool delivery. The second retained the native 403: account subscription
  lacked Kimi Code entitlement. Native CLI login succeeded, and the user then
  subscribed. Those failures remain failures; no cost counters were available.
- The first entitled turn completed native execution and called the exact MCP
  echo with the instruction-only nonce. Its smoke observer incorrectly expected
  `paperclip_echo` at a handler that receives canonical `echo`. Native arguments,
  MCP receiver error, and terminal completion establish a grading/observer failure,
  not a successful tool round trip. The corrected observer then passed a real
  authenticated semantic echo, native terminal completion, and physical cleanup.
  Its profile2 evidence is retained separately from the final candidate.
- Review found and corrected a real normal-path gap: the packaged sidecar's
  handwritten agent parser omitted Kimi even though direct driver metadata passed.
  Final sidecar checks and real Rust/sidecar product acceptance remain required.
- Native controlled-model probes use the actual pinned Kimi and bundled ACPX.
  They found upstream approval construction omitted `toolInput`; the owned patch
  now carries exact nested and UTF-8 arguments, including empty objects. Denied
  Write caused no file effect, and native HTTP418 remained a typed failed turn.
- The next probe found provider credentials inherited into native Bash. The
  patch filters `KIMI_API_KEY` and private instruction transport from native
  subprocesses while preserving explicitly assigned task variables. Actual ACPX
  always advertises terminal capability, which routed Bash through its own host;
  the final provider patch forces the owned filtered native process path instead.
  Final verification must observe zero `terminal/create` requests and no secret
  in the actual child, rather than merely inspecting a filtered object.
- Bundling exposed a `Function.toString()` source difference that changed patched
  native bytes. The patch now embeds one canonical static helper source; raw and
  archived CJS setup produce the same pinned output. Final source comment removal
  changes its byte identity again before profile4 freeze; old evidence keeps its
  original closure and profile identity.
- Required repository checks remaining: final full typecheck, supported full test
  run with the original infrastructure failure retained, full build, and the
  ordinary setup/save/reopen/Test/run/reconnect path. Token gates and map structure
  currently pass. Setup Test now uses the official authenticated model catalog;
  it does not claim inference, quota, or task execution from a metadata response.

The full repository build passed on candidate profile5. Its first Product E2E
message-marker attempt reached real UI/server/database setup, then stayed paused:
the installed-runtime-only Test warning is rejected by the ordinary agent lifecycle.
No model turn started. This candidate failure is preserved separately from the
retry. The correction performs a fixed-endpoint authenticated model-catalog probe
before reporting a successful Test. A real catalog request accepted the credential
and returned exact `kimi-for-coding`; the official `KimiCLI/2.3.3` client header
is required (a generic client was rejected with HTTP403). The selected ID is never
substituted. The first release also disables native question and plan tools so
only the promised semantic interaction path remains available.

Historical profile8 command digest:
`sha256:53c63af8722894e14d48ed55526f99fcd79e06c86ae1c7aa384ef7ee8c56efd4`.
Native runtime patch v6 SHA256:
`79980aa95c54f325a05cbdf883f74443705db28f3e412a1b5ae22929d939eb66`.
Closure pins: macOS arm64 `6038325abd0431c30097ff1f572a9b29816e1b4da372d8cb86b2ca5d18ea34e7`,
Linux x64 `105d8394adbbc76a953a12cc51b5288eb940ad693291e584f6cdc6407213164d`.
The actual native Kimi plus bundled ACPX controlled-service probes passed seven
requests for instructions/arguments/auth fencing/denial/failure, then nine for
pending-permission Stop and spontaneous owned native-worker loss. Both pending
callbacks aborted, stale approval caused no response/write/new model request,
and workers physically retired within five seconds. The model service was simulated;
these results do not establish authenticated product acceptance.

To retain native macOS Runner acceptance without changing shared IPC state, an
official checksummed PostgreSQL18.6 build with named POSIX semaphores passed fresh
initialization, normal migrations, SQL empty-database checks, and cleanup. Only
this worktree's unshared native dependency entry was temporarily pointed at that
private build. It was restored before canonical public-package staging. The
accepted database process/version must be disclosed with each affected result;
no database fixture contract or tracked dependency file was changed.

Campaign cost: subscription model calls have no reliable native usage counters;
cost is unknown. One cloud job was stopped during pre-build; no image or Daytona sandbox exists. Original
403s, the grading defect, credential-boundary failures, and database setup failure
remain separate failed or blocked attempts; none are overwritten by retries.

The Code endpoint for this finite release is the global coding API
`https://api.kimi.ai/coding/v1`, matching the successfully restored account.
Mainland-region routing and managed OAuth refresh are outside this release.
Authenticated qualification binds only the existing login's access token to the
isolated run; refresh tokens and the ambient login home are not transferred.

The second local message-marker attempt reached the real model and tools. Run
`4d394aef-0e6a-49a8-9fb0-873651d0241f` finished in 24 seconds, accepted the finish
contract, saved task Done, and passed physical cleanup. Its original verdict is
failed: progress text and final text shared one provider item, so the visible
final bubble contained both. Native patch v5 now forwards actual turn-step UUID
boundaries. The Kimi projection validates their provenance and order before
passing generic assistant boundaries to Runner. It does not infer boundaries
from text, tools, or HTTP response identifiers. The actual native Kimi/ACPX
controlled peer passed this framing case alongside instructions, tool arguments,
credential isolation, denial, typed failure, Stop, and native-worker loss.

Historical profile7 verification: 162 sidecar/projection/metadata/instruction tests,
144 driver/projection tests, and 18 Rust provider-state tests passed. TypeScript,
Rust daemon staging, bundled entrypoints, and all three affected immutable
profile checks passed. The archived installer passed fresh public downloads,
offline reuse, tamper rejection and cancellation on profile7. Final installed
CLI/server tarballs remain to be rebuilt and checked. The full repository test
run continues against the owned migrated PostgreSQL18.6 Docker database; the
earlier host semaphore and unmigrated-database setup failures remain retained.

The third local message-marker attempt passed all six independent matchers,
accepted finish, durable Done, and cleanup on profile7/source
`5fe7d496e1603626ceb5838f37c4fecce23580ee`. Campaign
`local-2026-10-28T14-24-09-928Z`, run
`68705f91-d195-4532-9fd4-e8b1826d6ed9`, completed in 45.1 seconds including
cleanup and evidence collection. Its rendered final reply is the exact marker.
The profile7 installed CLI/server tarballs also passed fresh public setup,
offline reuse, exact native create/model/load/instruction receipts and EOF.

Lifecycle authoring then found that native Kimi approval omitted its tool kind.
Patch v6 carries the native tool's existing canonical kind. The actual native
callback now passes shared normalization: exact Write target with Allow once,
Deny and Cancel; missing/foreign workspace contexts offer only Deny/Cancel and
reject acceptance. The complete nine-request controlled native peer passed.
The engine metadata correction and v6 change advance the installed closures.
Profile7 evidence retains its original identity; the affected permission and
installed-runtime paths require profile8 evidence before qualification.

CI found stale dependent provider attestations and fixture expectations. Pi31
attests the changed shared environment/sandbox sources without changing its native
closure. Copilot73 attests historical-profile decoding changes; Grok11 remains
current. Old fixtures stay immutable. Ninety-five Pi/Copilot installation tests
passed with one existing opt-in skip, plus 18 image contract tests and four Grok
identity-generator tests. Kimi lifecycle authoring passed 44 deterministic cases;
the exact Linux pidfd selector passed 14 real cases on native ARM64 Linux and 110
TypeScript observer/contract tests with one existing skip. Linux x64 emulation
returned ENOSYS for pidfd and is retained as an unsuccessful infrastructure
attempt; only actual Daytona Linux x64 can qualify that target.

The rebased profile7 full typecheck/build passed and profile8 full build passed
before the final dependent-provider identity refresh. The local full-test run
was interrupted after unrelated shared-database cleanup failures and stale
migration module errors. A fresh current-build isolated PostgreSQL migration
probe passed. A replacement full run and final checks remain required. Later
focused HTTP tests hit import/hook timeouts while host load was 63/120 with 92%
CPU use; their original failures remain retained, without committed deadline
increases. CI for the corrected source will provide an independent Linux check.

Review branches are published as draft PRs [Runner foundation #18028](https://github.com/paperclipai/paperclip/pull/18028)
and [product setup #18029](https://github.com/paperclipai/paperclip/pull/18029).
The first foundation review was 5/5 with no comments on its exact prior head;
the corrected final head requires a fresh review. Neither PR is ready for merge
until required product acceptance and checks pass.
