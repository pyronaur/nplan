import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import plannotator from "./plannotator-fork.ts";

export default function nplan(pi: ExtensionAPI): void {
	plannotator(pi);
}
