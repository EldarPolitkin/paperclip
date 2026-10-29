export function manualEvidenceRouting(environment: NodeJS.ProcessEnv): {
  retention: "recurring" | "actions" | "private";
  executionIds: string[];
};
export function authorizeManualCellRoute(retention: string | undefined, executionId: string, privateIds: string): "actions" | "private";
