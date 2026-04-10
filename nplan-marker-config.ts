export type PlanMarkerName = "resumed" | "stopped" | "abandoned";

export interface PlanMarkersConfig {
	resumed?: string | null;
	stopped?: string | null;
	abandoned?: string | null;
}

export function normalizeMarkers(
	value: unknown,
	normalizeOptionalString: (value: unknown) => string | null | undefined,
): PlanMarkersConfig | null | undefined {
	if (value === null) {
		return null;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}

	return {
		resumed: normalizeOptionalString("resumed" in value ? value.resumed : undefined),
		stopped: normalizeOptionalString("stopped" in value ? value.stopped : undefined),
		abandoned: normalizeOptionalString("abandoned" in value ? value.abandoned : undefined),
	};
}

export function mergeMarkers(
	base: PlanMarkersConfig | null | undefined,
	override: PlanMarkersConfig | null | undefined,
): PlanMarkersConfig | null | undefined {
	if (override === null) {
		return null;
	}
	if (override === undefined) {
		return base ? { ...base } : base;
	}

	return {
		resumed: override.resumed !== undefined ? override.resumed : base?.resumed,
		stopped: override.stopped !== undefined ? override.stopped : base?.stopped,
		abandoned: override.abandoned !== undefined ? override.abandoned : base?.abandoned,
	};
}

export function resolvePlanMarkerTemplate(
	markers: PlanMarkersConfig | null | undefined,
	name: PlanMarkerName,
	resolveString: (base: string | null | undefined, override: string | null | undefined) => string | undefined,
): string | undefined {
	return resolveString(undefined, markers?.[name]);
}