export const TEMPLATE_POLICY = {
	planningApplyPatchDeleteBlocked(input: { planFilePath: string }): string {
		return `Plan mode: apply_patch cannot delete files during planning. Patch only ${input.planFilePath}.`;
	},
	planningApplyPatchEmptyBlocked(): string {
		return "Plan mode: empty apply_patch payloads are not allowed during planning.";
	},
	planningApplyPatchMalformedPathBlocked(): string {
		return "Plan mode: malformed apply_patch path during planning.";
	},
	planningApplyPatchMissingTargetBlocked(): string {
		return "Plan mode: apply_patch is allowed during planning only for patches that target the active plan file.";
	},
	planningApplyPatchMoveBlocked(input: { planFilePath: string }): string {
		return `Plan mode: apply_patch cannot move files during planning. Patch only ${input.planFilePath}.`;
	},
	planningApplyPatchPathBlocked(
		input: { planFilePath: string; blockedPath: string },
	): string {
		return `Plan mode: apply_patch is restricted to ${input.planFilePath} during planning. Blocked: ${input.blockedPath}`;
	},
	planningBashEmptyBlocked(): string {
		return "Plan mode: empty bash commands are not allowed during planning.";
	},
	planningBashMutatingBlocked(input: { command: string }): string {
		return `Plan mode: bash commands that can modify files or system state are blocked during planning. Plan mode is for planning; do not mutate files outside the active plan file. Blocked: ${input.command}`;
	},
	planningToolPathBlocked(
		input: { kind: string; planFilePath: string; blockedPath: string },
	): string {
		return `Plan mode: ${input.kind} are restricted to ${input.planFilePath} during planning. Blocked: ${input.blockedPath}`;
	},
};
