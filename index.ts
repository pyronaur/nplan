import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import upstreamPlannotator from "./vendor/plannotator/apps/pi-extension/index.ts";
import { createNplanExtensionApiShim } from "./shim.ts";

export default function nplan(pi: ExtensionAPI): void {
	upstreamPlannotator(createNplanExtensionApiShim(pi));
}
