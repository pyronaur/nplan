type RuntimeRegistry = {
	activeRuntimeToken: string | null;
};

const NPLAN_RUNTIME_REGISTRY_KEY = "__nplanRuntimeRegistry";

function getRuntimeRegistry(): RuntimeRegistry {
	const globalRegistry = globalThis as typeof globalThis & {
		[NPLAN_RUNTIME_REGISTRY_KEY]?: RuntimeRegistry;
	};
	globalRegistry[NPLAN_RUNTIME_REGISTRY_KEY] ??= { activeRuntimeToken: null };
	return globalRegistry[NPLAN_RUNTIME_REGISTRY_KEY];
}

export function createRuntimeGuard(runtimeToken = `${Date.now()}:${Math.random().toString(36).slice(2)}`): {
	activate(): void;
	isActive(): boolean;
	deactivate(): void;
} {
	const runtimeRegistry = getRuntimeRegistry();

	return {
		activate(): void {
			runtimeRegistry.activeRuntimeToken = runtimeToken;
		},
		isActive(): boolean {
			return runtimeRegistry.activeRuntimeToken === runtimeToken;
		},
		deactivate(): void {
			if (runtimeRegistry.activeRuntimeToken === runtimeToken) {
				runtimeRegistry.activeRuntimeToken = null;
			}
		},
	};
}
