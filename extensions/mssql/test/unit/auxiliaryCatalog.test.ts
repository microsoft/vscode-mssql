/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B23 (OE_V1_PARITY_PLAN §2.2): auxiliary catalog sections — lazy per-folder
 * hydration (never at connect), single-flight coalescing, per-section
 * failure honesty, and the server sections' row mapping (disabled badges,
 * fixed-role/system marking, user-only error messages).
 */

import { expect } from "chai";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import { ISqlSession } from "../../src/services/sqlDataPlane/api";
import { MetadataSessionSource } from "../../src/services/metadata/metadataService";
import {
    AuxiliaryCatalog,
    SERVER_AUX_SECTIONS,
} from "../../src/services/metadata/auxiliaryCatalog";
import { ServerMetadataService } from "../../src/services/metadata/serverMetadataService";

class SimpleSource implements MetadataSessionSource {
    private session: ISqlSession | undefined;
    constructor(private readonly backend: FakeBackend) {}
    async open(): Promise<ISqlSession> {
        if (this.session && this.session.state === "open") {
            return this.session;
        }
        this.session = await this.backend.openSession({
            profile: { profileFingerprint: "fp", server: "srv", authKind: "sql", user: "u" },
            applicationName: "test",
        });
        return this.session;
    }
}

function serverScripts(counters: Record<string, number>): FakeScript[] {
    const count = (key: string) => {
        counters[key] = (counters[key] ?? 0) + 1;
    };
    return [
        {
            match: (t) => {
                const hit = t.includes("sys.server_principals") && t.includes("is_disabled");
                if (hit) {
                    count("logins");
                }
                return hit;
            },
            events: [
                {
                    type: "resultSet",
                    columns: ["name", "type", "is_disabled"],
                    rows: [
                        ["appLogin", "S", 0],
                        ["CONTOSO\\svc", "U", 0],
                        ["oldLogin", "S", 1],
                    ],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => {
                const hit = t.includes("sys.server_principals") && t.includes("is_fixed_role");
                if (hit) {
                    count("serverRoles");
                }
                return hit;
            },
            events: [
                {
                    type: "resultSet",
                    columns: ["name", "is_fixed_role"],
                    rows: [
                        ["customRole", 0],
                        ["sysadmin", 1],
                    ],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => {
                const hit = t.includes("sys.messages");
                if (hit) {
                    count("errorMessages");
                }
                return hit;
            },
            events: [
                {
                    type: "resultSet",
                    columns: ["message_id"],
                    rows: [[50001], [51000]],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("sys.databases"),
            events: [
                {
                    type: "resultSet",
                    columns: [
                        "database_id",
                        "name",
                        "state_desc",
                        "is_read_only",
                        "user_access_desc",
                        "compatibility_level",
                        "has_dbaccess",
                    ],
                    rows: [[5, "AppDb", "ONLINE", 0, "MULTI_USER", 160, 1]],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        // NOTE: no script matches sys.credentials — the failure-honesty test
        // relies on that query failing in the fake backend.
    ];
}

suite("Auxiliary catalog sections (B23)", () => {
    test("lazy by construction: server hydration runs ZERO aux queries", async () => {
        const counters: Record<string, number> = {};
        const backend = new FakeBackend({ scripts: serverScripts(counters) });
        const service = new ServerMetadataService(new SimpleSource(backend));
        await service.ensureHydrated();
        expect(service.status().readiness).to.equal("ready");
        expect(counters.logins ?? 0).to.equal(0);
        expect(counters.serverRoles ?? 0).to.equal(0);
        for (const key of service.auxiliary.sectionKeys()) {
            expect(service.auxiliary.status(key).readiness, key).to.equal("absent");
        }
        service.dispose();
    });

    test("logins: fetched on demand, disabled badge mapped, cached thereafter", async () => {
        const counters: Record<string, number> = {};
        const backend = new FakeBackend({ scripts: serverScripts(counters) });
        const aux = new AuxiliaryCatalog(new SimpleSource(backend), SERVER_AUX_SECTIONS, "t");
        await aux.ensureSection("security/logins");
        const items = aux.items("security/logins");
        expect(items?.map((i) => `${i.name}${i.subType ? `:${i.subType}` : ""}`)).to.deep.equal([
            "appLogin",
            "CONTOSO\\svc",
            "oldLogin:disabled",
        ]);
        expect(aux.status("security/logins")).to.deep.include({
            readiness: "ready",
            itemCount: 3,
        });
        // warm re-ensure: no second query
        await aux.ensureSection("security/logins");
        expect(counters.logins).to.equal(1);
        aux.dispose();
    });

    test("concurrent expands single-flight onto one query", async () => {
        const counters: Record<string, number> = {};
        const backend = new FakeBackend({ scripts: serverScripts(counters) });
        const aux = new AuxiliaryCatalog(new SimpleSource(backend), SERVER_AUX_SECTIONS, "t");
        await Promise.all([
            aux.ensureSection("security/serverRoles"),
            aux.ensureSection("security/serverRoles"),
            aux.ensureSection("security/serverRoles"),
        ]);
        expect(counters.serverRoles).to.equal(1);
        const items = aux.items("security/serverRoles");
        expect(items?.map((i) => `${i.name}:${i.isSystem}`)).to.deep.equal([
            "customRole:false",
            "sysadmin:true",
        ]);
        aux.dispose();
    });

    test("per-section failure honesty: failed ≠ empty, refresh recovers nothing silently", async () => {
        const counters: Record<string, number> = {};
        const backend = new FakeBackend({ scripts: serverScripts(counters) });
        const aux = new AuxiliaryCatalog(new SimpleSource(backend), SERVER_AUX_SECTIONS, "t");
        await aux.ensureSection("security/credentials"); // no matching script → fails
        const status = aux.status("security/credentials");
        expect(status.readiness).to.equal("failed");
        expect(status.errorMessage).to.be.a("string").and.not.equal("");
        expect(aux.items("security/credentials")).to.equal(undefined);
        // other sections unaffected
        await aux.ensureSection("serverObjects/errorMessages");
        expect(aux.items("serverObjects/errorMessages")?.map((i) => i.name)).to.deep.equal([
            "50001",
            "51000",
        ]);
        aux.dispose();
    });

    test("unknown section key rejects loudly", async () => {
        const backend = new FakeBackend({ scripts: [] });
        const aux = new AuxiliaryCatalog(new SimpleSource(backend), SERVER_AUX_SECTIONS, "t");
        let failed = false;
        await aux.ensureSection("security/nonsense").catch(() => (failed = true));
        expect(failed).to.equal(true);
        aux.dispose();
    });

    test("server lease change stream carries aux updates; statusDump lists every section", async () => {
        const counters: Record<string, number> = {};
        const backend = new FakeBackend({ scripts: serverScripts(counters) });
        const service = new ServerMetadataService(new SimpleSource(backend));
        let notifications = 0;
        const subscription = service.onDidChange(() => notifications++);
        await service.auxiliary.ensureSection("security/logins");
        expect(notifications).to.be.greaterThan(0); // loading + ready ticks
        const dump = service.auxiliary.statusDump();
        expect(Object.keys(dump)).to.have.length(SERVER_AUX_SECTIONS.length);
        expect(dump["security/logins"].readiness).to.equal("ready");
        expect(dump["serverObjects/endpoints"].readiness).to.equal("absent");
        subscription.dispose();
        service.dispose();
    });
});
