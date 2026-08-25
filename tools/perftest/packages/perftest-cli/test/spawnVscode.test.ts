/**
 * The child VS Code environment must be scrubbed of the parent's Electron/VS
 * Code launch hooks so the harness works when invoked from a VS Code
 * integrated terminal (WSL remote). Regression guard for the exit-9
 * `bad option: --user-data-dir` failure (packaged binary re-execs as Node when
 * ELECTRON_RUN_AS_NODE / VSCODE_* leak into the launch).
 */

import { afterEach, describe, expect, it } from "vitest";
import { buildChildEnv } from "../src/launch/spawnVscode";

describe("buildChildEnv", () => {
    const saved = { ...process.env };
    afterEach(() => {
        for (const k of Object.keys(process.env)) {
            if (!(k in saved)) delete process.env[k];
        }
        Object.assign(process.env, saved);
    });

    it("strips ELECTRON_RUN_AS_NODE and every VSCODE_* hook from the parent env", () => {
        process.env["ELECTRON_RUN_AS_NODE"] = "1";
        process.env["VSCODE_IPC_HOOK_CLI"] = "/tmp/hook.sock";
        process.env["VSCODE_NLS_CONFIG"] = "{}";
        process.env["VSCODE_CWD"] = "/somewhere";
        process.env["PERFTEST_KEEPME"] = "yes";

        const env = buildChildEnv({});

        expect(env["ELECTRON_RUN_AS_NODE"]).toBeUndefined();
        expect(env["VSCODE_IPC_HOOK_CLI"]).toBeUndefined();
        expect(env["VSCODE_NLS_CONFIG"]).toBeUndefined();
        expect(env["VSCODE_CWD"]).toBeUndefined();
        // Non-hook parent vars are preserved.
        expect(env["PERFTEST_KEEPME"]).toBe("yes");
    });

    it("applies harness overrides last so they always win", () => {
        process.env["ELECTRON_RUN_AS_NODE"] = "1";
        const env = buildChildEnv({ PERF_MODE: "1", PERF_MARKER_URL: "ws://127.0.0.1:1/x" });
        expect(env["PERF_MODE"]).toBe("1");
        expect(env["PERF_MARKER_URL"]).toBe("ws://127.0.0.1:1/x");
        expect(env["ELECTRON_RUN_AS_NODE"]).toBeUndefined();
    });
});
