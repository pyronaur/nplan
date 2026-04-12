export type PlanMarkerName = "ended";

export interface PlanMarkersConfig {
	ended?: string | null;
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
		ended: normalizeOptionalString("ended" in value ? value.ended : undefined),
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
		ended: override.ended !== undefined ? override.ended : base?.ended,
	};
}

export function resolvePlanMarkerTemplate(
	markers: PlanMarkersConfig | null | undefined,
	name: PlanMarkerName,
	resolveString: (
		base: string | null | undefined,
		override: string | null | undefined,
	) => string | undefined,
): string | undefined {
	return resolveString(undefined, markers?.[name]);
}
