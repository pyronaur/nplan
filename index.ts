import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import nplanExtension from "./nplan.ts";

export default function nplan(pi: ExtensionAPI): void {
	nplanExtension(pi);
}
