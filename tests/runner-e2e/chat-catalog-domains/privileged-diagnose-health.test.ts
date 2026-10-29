import { expect, it } from "vitest";
import { ownedPostmasterStillMatches } from "./privileged-database-fault.js";
import { gradeDiagnoseHealth, supportedDiagnosticOperator } from "./privileged-diagnose-health.js";
it("refuses a reused PID, wrong UID/port/directory or a substring lookalike process before control", () => {
  const original = { pid: 123, startedAt: "1000", directory: "/owned/db", port: 54329, uid: 501, binary: "/pinned/bin/postgres",
    marker: ["123", "/owned/db", "1000", "54329"], processRow: "501 /pinned/bin/postgres -D /owned/db -p 54329" };
  expect(ownedPostmasterStillMatches(original)).toBe(true);
  for (const delta of [{ marker: ["124", "/owned/db", "1000", "54329"] }, { marker: ["123", "/owned/db", "2000", "54329"] },
    { marker: ["123", "/owned/db", "1000", "60000"] }, { processRow: "502 /pinned/bin/postgres -D /owned/db -p 54329" },
    { processRow: "501 /pinned/bin/postgres -D /owned/db-elsewhere -p 54329" }, { processRow: "501 /another/bin/postgres -D /owned/db -p 54329" }])
    expect(ownedPostmasterStillMatches({ ...original, ...delta })).toBe(false);
});
const targetUrl = "http://127.0.0.1:31097", description = `Diagnostic subject: ${targetUrl}.`;
function valid() { return { scenarioId: "instance-operations.diagnose-health", origin: "http://controller.invalid", companyId: "owned", leadId: "lead",
  tasks: [], projects: [{ id: "target-project", companyId: "owned", description }], goals: [], comments: [], activity: [], documents: [], revisions: [], links: [],
  humanQueries: ["Is this Paperclip instance healthy enough to run work?"], runs: [{ id: "run", status: "succeeded" }],
  reply: `The database prerequisite is failing; this instance is not ready to run work. Operator, run doctor for ${targetUrl}.`,
  state: { targetUrl, healthStatus: 503, healthError: "database_unreachable", doctorFailed: true, targetOwned: true, targetInitiallyReady: true,
    controllerHealthy: true, controllerAgentReady: true, targetContextVisible: true, sourceProjectId: "target-project", targetProject: { id: "target-project", companyId: "owned", description },
    nativeTargetHealthResponse: false, operatorDoctorAfterGuidance: true } }; }
it("accepts genuine target doctor guidance with healthy controller admission", () => { expect(gradeDiagnoseHealth(valid()).passed).toBe(true); });
it("accepts independent native target response without doctor-guidance substitution", () => {
  const o = valid(); o.state.nativeTargetHealthResponse = true; o.state.operatorDoctorAfterGuidance = false;
  o.reply = "The database is unavailable and this instance is not ready to run work."; expect(gradeDiagnoseHealth(o).passed).toBe(true);
});
it("rejects generic prose, fixture-only observation, wrong target, missing visible binding, stale fault and liveness-only health", () => {
  const o = valid();
  for (const delta of [{ nativeTargetHealthResponse: false, operatorDoctorAfterGuidance: false }, { controllerHealthy: false }, { controllerAgentReady: false },
    { targetOwned: false }, { targetContextVisible: false }, { sourceProjectId: "other" }, { healthStatus: 200 }, { doctorFailed: false }, { targetUrl: "http://other.invalid" }])
    expect(gradeDiagnoseHealth({ ...o, state: { ...o.state, ...delta } }).passed).toBe(false);
  for (const reply of ["Check your instance and its logs.", `The database is not ready. Operator, do not run doctor for ${targetUrl}.`, `The database is not ready. Operator, run doctor for http://other.invalid; the diagnostic target is ${targetUrl}.`, "The HTTP port works, so it is healthy enough and ready to run work.", "The controller database is not ready. An operator should run doctor on http://other.invalid."])
    expect(gradeDiagnoseHealth({ ...o, reply }).passed).toBe(false);
  expect(gradeDiagnoseHealth({ ...o, runs: [] }).passed).toBe(false);
  expect(gradeDiagnoseHealth({ ...o, humanQueries: ["different"] }).passed).toBe(false);
  expect(gradeDiagnoseHealth({ ...o, projects: [{ id: "target-project", companyId: "foreign", description }] }).passed).toBe(false);
});

it("accepts context-bound multiline operator guidance but never self-inability or another subject", () => {
  expect(supportedDiagnosticOperator(`The diagnostic target is ${targetUrl}.\nAn operator can run paperclipai doctor for that instance in a terminal.`, targetUrl)).toBe(true);
  expect(supportedDiagnosticOperator(`From your terminal, run paperclipai doctor for ${targetUrl}.`, targetUrl)).toBe(true);
  expect(supportedDiagnosticOperator(`I will run doctor for you on ${targetUrl}.`, targetUrl)).toBe(false);
  expect(supportedDiagnosticOperator(`I run doctor for ${targetUrl} in a terminal.`, targetUrl)).toBe(false);
  expect(supportedDiagnosticOperator(`I cannot run doctor for your ${targetUrl}.`, targetUrl)).toBe(false);
  expect(supportedDiagnosticOperator(`Target ${targetUrl}.\nAn operator can run doctor for http://other.invalid in a terminal.`, targetUrl)).toBe(false);
  expect(supportedDiagnosticOperator(`Target ${targetUrl}.\nCould an operator run doctor for that instance?`, targetUrl)).toBe(false);
});

it.each(["- Run paperclipai doctor.", "1. Run paperclipai doctor.", "Could you run doctor on that instance?", "You can run paperclipai doctor in your terminal."])("uses the visible subject with ordinary operator formatting: %s", line => {
  expect(supportedDiagnosticOperator(line, targetUrl)).toBe(true);
});
it("does not redirect doctor guidance to the chat controller or reverse a prohibition", () => {
  expect(supportedDiagnosticOperator("You can run doctor on the controller.", targetUrl)).toBe(false);
  expect(supportedDiagnosticOperator(`You should not run doctor for ${targetUrl}.`, targetUrl)).toBe(false);
});
