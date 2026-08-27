/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TSQ2 §8.2: SqlDataPlaneService.openSessionWithFallback — the single connect
 * path every consumer (Query Studio, Object Explorer v2, …) routes through so
 * the Windows-auth → SQL Tools Service experience is identical. Pins: a profile
 * the default backend can't open prompts and routes to the alternative; the
 * route is remembered per profile (no re-prompt on reconnect); a config change
 * forgets it; policy "off" surfaces the typed error; and a profile the default
 * CAN open never prompts.
 */

import { expect } from "chai";
import {
    DataPlaneErrorCodes,
    ISqlConnectionService,
    OpenSessionParams,
    SqlConnectionProfileRef,
    SqlDataPlaneError,
} from "../../src/services/sqlDataPlane/api";
import {
    DataPlaneConfigReader,
    SqlBackendFactory,
    SqlBackendKind,
} from "../../src/services/sqlDataPlane/backendFactory";
import {
    capabilitySet,
    supported,
    unsupported,
} from "../../src/services/sqlDataPlane/capabilityRegistry";
import { SqlDataPlaneService } from "../../src/services/sqlDataPlane/sqlDataPlaneService";
import { FakeBackend } from "../../src/services/sqlDataPlane/fakeBackend";
import {
    CAPABILITY_FALLBACK_SETTING,
    CapabilityFallbackPolicy,
    FallbackInteraction,
} from "../../src/services/sqlDataPlane/providerSuggestions";

const SETTING_BACKEND = "mssql.sqlDataPlane.backend";

class TestConfig implements DataPlaneConfigReader {
    constructor(private readonly values = new Map<string, unknown>()) {}
    set(key: string, value: unknown): void {
        this.values.set(key, value);
    }
    get<T>(section: string, defaultValue: T): T {
        return this.values.has(section) ? (this.values.get(section) as T) : defaultValue;
    }
}

function backend(kind: SqlBackendKind, integrated: boolean): SqlBackendFactory {
    return {
        kind,
        displayName: kind === "ts-native" ? "Native TypeScript (tedious)" : "SQL Tools Service",
        realmClass: "local",
        identity: {
            kind,
            implementation: "fake",
            transport: "inprocess",
            driver: "fake",
            deployment: "test",
            realmId: "local",
            providerVersion: "0",
        },
        staticCapabilities: capabilitySet({
            "auth.sqlLogin": supported("static"),
            "auth.integrated": integrated
                ? supported("static")
                : unsupported("static", "driver.noIntegratedAuth"),
            "exec.streamingRows": supported("static"),
        }),
        fingerprintSettings: [],
        create: async (): Promise<ISqlConnectionService> => new FakeBackend({}),
    };
}

function recorder(pick: boolean) {
    const prompts: string[] = [];
    const notes: string[] = [];
    const interaction: FallbackInteraction = {
        prompt: async (message, actions) => {
            prompts.push(message);
            return pick ? actions[0] : undefined;
        },
        notify: (message) => {
            notes.push(message);
        },
    };
    return { interaction, prompts, notes };
}

const WIN_PROFILE: SqlConnectionProfileRef = {
    profileFingerprint: "fp_win",
    server: "localhost",
    authKind: "integrated",
};

function params(profile: SqlConnectionProfileRef = WIN_PROFILE): OpenSessionParams {
    return { profile, applicationName: "test" };
}

function makeService(policy: CapabilityFallbackPolicy = "prompt"): SqlDataPlaneService {
    const config = new TestConfig();
    config.set(SETTING_BACKEND, "ts-native");
    config.set(CAPABILITY_FALLBACK_SETTING, policy);
    return new SqlDataPlaneService(
        config,
        [backend("ts-native", false), backend("sts2-local", true)],
        "test",
    );
}

suite("SQL Data Plane fallback open (TSQ2 §8.2)", () => {
    test("a Windows-auth profile prompts and falls back to the SQL Tools Service backend", async () => {
        const svc = makeService("prompt");
        const { interaction, prompts } = recorder(true);
        const { session, decision } = await svc.openSessionWithFallback(
            params(),
            undefined,
            interaction,
        );
        expect(prompts).to.have.length(1);
        expect(decision?.kind).to.equal("useAlternative");
        expect(decision?.alternative).to.equal("sts2-local");
        expect(session).to.exist;
    });

    test("auto policy routes without a prompt but with a visible notification", async () => {
        const svc = makeService("auto");
        const { interaction, prompts, notes } = recorder(false);
        const { decision } = await svc.openSessionWithFallback(params(), undefined, interaction);
        expect(prompts).to.have.length(0);
        expect(notes).to.have.length(1);
        expect(decision?.automatic).to.equal(true);
        expect(decision?.alternative).to.equal("sts2-local");
    });

    test("remembers the route: a reconnect to the same profile does not re-prompt", async () => {
        const svc = makeService("prompt");
        const first = recorder(true);
        await svc.openSessionWithFallback(params(), undefined, first.interaction);
        expect(first.prompts).to.have.length(1);

        const second = recorder(true);
        const { decision } = await svc.openSessionWithFallback(
            params(),
            undefined,
            second.interaction,
        );
        expect(second.prompts, "remembered route skips the prompt").to.have.length(0);
        expect(decision, "no re-resolution on the remembered path").to.equal(undefined);
        expect(svc.rememberedFallbacks()).to.deep.include({
            profileFingerprint: "fp_win",
            backendKind: "sts2-local",
        });
    });

    test("an explicit per-document override wins over the remembered route and is not remembered", async () => {
        const svc = makeService("prompt");
        // Pin sts2-local explicitly: it can open integrated auth, so no prompt.
        const pinned = recorder(true);
        await svc.openSessionWithFallback(
            params(),
            { backendKind: "sts2-local" },
            pinned.interaction,
        );
        expect(pinned.prompts).to.have.length(0);
        expect(svc.rememberedFallbacks(), "an override is not remembered").to.deep.equal([]);
    });

    test("a config change forgets remembered routes", async () => {
        const svc = makeService("prompt");
        await svc.openSessionWithFallback(params(), undefined, recorder(true).interaction);
        expect(svc.rememberedFallbacks()).to.have.length(1);
        svc.handleConfigurationChanged();
        expect(svc.rememberedFallbacks()).to.deep.equal([]);
        const again = recorder(true);
        await svc.openSessionWithFallback(params(), undefined, again.interaction);
        expect(again.prompts, "re-prompts after config change").to.have.length(1);
    });

    test("policy off surfaces the typed capability error instead of routing", async () => {
        const svc = makeService("off");
        const { interaction, prompts } = recorder(true);
        let error: unknown;
        try {
            await svc.openSessionWithFallback(params(), undefined, interaction);
        } catch (e) {
            error = e;
        }
        expect(prompts).to.have.length(0);
        expect(error).to.be.instanceOf(SqlDataPlaneError);
        expect((error as SqlDataPlaneError).code).to.equal(
            DataPlaneErrorCodes.capabilityUnsupported,
        );
    });

    test("a SQL-auth profile the default can open never prompts or falls back", async () => {
        const svc = makeService("prompt");
        const { interaction, prompts } = recorder(true);
        const sqlProfile: SqlConnectionProfileRef = {
            profileFingerprint: "fp_sql",
            server: "localhost",
            authKind: "sql",
            user: "sa",
        };
        const { decision } = await svc.openSessionWithFallback(
            params(sqlProfile),
            undefined,
            interaction,
        );
        expect(prompts).to.have.length(0);
        expect(decision).to.equal(undefined);
    });
});
