/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Optional localhost smoke for the exact extract -> named deploy -> schema
 * inventory workflow used by the Runbook Studio repro. The target is created
 * only when WWI_2 is absent, marked with this test's ownership identity, and
 * removed only while that exact marker remains. Credentials are never logged
 * or persisted. */

import { randomBytes } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expect } from "chai";
import * as vscode from "vscode";
import type * as mssql from "vscode-mssql";
import { TaskExecutionMode } from "../../src/enums";
import { parseSqlConnectionString } from "../../src/diagnostics/selfTest/connectionString";
import {
    buildCreateLocalDevelopmentDatabaseSql,
    buildDropLocalDevelopmentDatabaseSql,
} from "../../src/runbookStudio/runtime/localDevelopmentDatabaseOperations";
import { buildLocalDeploymentPreviewResult } from "../../src/runbookStudio/runtime/localDeveloperOperations";
import { localManagedArtifactFileName } from "../../src/runbookStudio/runtime/localManagedArtifacts";
import { LOCAL_SCHEMA_INVENTORY_SQL } from "../../src/runbookStudio/runtime/localSchemaInventory";

const LIVE_ENABLED = process.env.RBS2_DACPAC_LIVE === "1";
const CONNECTION_STRING =
    process.env.STS2_SQLSERVER_SQLLOGIN_CONNSTRING ?? process.env.STS2_SQLSERVER_CONNSTRING;
const SOURCE_DATABASE = "WideWorldImporters";
const TARGET_DATABASE = "WWI_2";

suite("Runbook Studio DACPAC round trip live smoke (gated)", function () {
    this.timeout(360_000);

    suiteSetup(function () {
        if (!LIVE_ENABLED || !CONNECTION_STRING) {
            this.skip();
        }
        const parsed = parseSqlConnectionString(CONNECTION_STRING);
        if (
            "error" in parsed ||
            !/^(localhost|127\.0\.0\.1|\[::1\]|\.|\(local\))(?:[\\,].+)?$/i.test(
                parsed.parsed.server.replace(/^tcp:/i, ""),
            )
        ) {
            this.skip();
        }
    });

    test("extracts WideWorldImporters, deploys WWI_2, inventories it, and cleans exact ownership", async () => {
        const parsed = parseSqlConnectionString(CONNECTION_STRING!);
        if ("error" in parsed) {
            throw new Error(parsed.error);
        }
        const extension = vscode.extensions.getExtension<mssql.IExtension>("ms-mssql.mssql");
        expect(extension).not.to.equal(undefined);
        const api = await extension!.activate();
        const baseProfile = {
            server: parsed.parsed.server,
            database: "master",
            authenticationType: parsed.parsed.integrated ? "Integrated" : "SqlLogin",
            ...(parsed.parsed.user ? { user: parsed.parsed.user } : {}),
            ...(parsed.parsed.password ? { password: parsed.parsed.password } : {}),
            ...(parsed.parsed.encrypt ? { encrypt: parsed.parsed.encrypt } : {}),
            ...(parsed.parsed.trustServerCertificate !== undefined
                ? { trustServerCertificate: parsed.parsed.trustServerCertificate }
                : {}),
        } as mssql.IConnectionInfo;
        const effectId = `effect-${randomBytes(32).toString("hex")}`;
        const dacpacPath = path.join(
            os.tmpdir(),
            localManagedArtifactFileName(
                "extract",
                `rbs-WideWorldImporters-${randomBytes(8).toString("hex")}.dacpac`,
            ),
        );
        let sourceUri: string | undefined;
        let masterUri: string | undefined;
        let targetUri: string | undefined;
        let created = false;

        try {
            masterUri = await api.connect(baseProfile);
            const before = await api.connectionSharing.executeSimpleQuery(
                masterUri,
                `SELECT CAST(CASE WHEN DB_ID(N'${TARGET_DATABASE}') IS NULL THEN 0 ELSE 1 END AS int) AS database_exists;`,
            );
            expect(before.rows?.[0]?.[0]?.displayValue).to.equal("0");

            sourceUri = await api.connect({ ...baseProfile, database: SOURCE_DATABASE });
            const extracted = await api.dacFx.extractDacpac(
                SOURCE_DATABASE,
                dacpacPath,
                SOURCE_DATABASE,
                "1.0.0.0",
                sourceUri,
                TaskExecutionMode.execute,
            );
            expect(extracted.success, extracted.errorMessage).to.equal(true);
            expect((await fs.promises.stat(dacpacPath)).size).to.be.greaterThan(0);

            await api.connectionSharing.executeSimpleQuery(
                masterUri,
                buildCreateLocalDevelopmentDatabaseSql(TARGET_DATABASE, effectId),
            );
            created = true;
            targetUri = await api.connect({ ...baseProfile, database: TARGET_DATABASE });

            const previewResult = await api.dacFx.generateDeployPlan(
                dacpacPath,
                TARGET_DATABASE,
                targetUri,
                TaskExecutionMode.execute,
            );
            expect(previewResult.success, previewResult.errorMessage).to.equal(true);
            const preview = buildLocalDeploymentPreviewResult(
                dacpacPath,
                TARGET_DATABASE,
                previewResult.operationId,
                previewResult.report,
            );
            expect(preview.changeCount).to.be.greaterThan(0);

            const deployed = await api.dacFx.deployDacpac(
                dacpacPath,
                TARGET_DATABASE,
                true,
                targetUri,
                TaskExecutionMode.execute,
            );
            expect(deployed.success, deployed.errorMessage).to.equal(true);
            const inventory = await api.connectionSharing.executeSimpleQuery(
                targetUri,
                LOCAL_SCHEMA_INVENTORY_SQL,
            );
            expect(inventory.rowCount).to.be.greaterThan(0);
            const objectTypes = new Set(
                (inventory.rows ?? []).map((row) => row[0]?.displayValue).filter(Boolean),
            );
            expect(objectTypes).to.include("Table");
            expect(objectTypes).to.include("View");
            expect(objectTypes).to.include("Stored procedure");

            const verifyResult = await api.dacFx.generateDeployPlan(
                dacpacPath,
                TARGET_DATABASE,
                targetUri,
                TaskExecutionMode.execute,
            );
            expect(verifyResult.success, verifyResult.errorMessage).to.equal(true);
            const verification = buildLocalDeploymentPreviewResult(
                dacpacPath,
                TARGET_DATABASE,
                verifyResult.operationId,
                verifyResult.report,
            );
            expect(verification.changeCount).to.equal(0);
        } finally {
            if (targetUri) {
                api.connectionSharing.disconnect(targetUri);
                targetUri = undefined;
            }
            if (created && masterUri) {
                await api.connectionSharing.executeSimpleQuery(
                    masterUri,
                    buildDropLocalDevelopmentDatabaseSql(TARGET_DATABASE, effectId),
                );
                created = false;
            }
            if (sourceUri) {
                api.connectionSharing.disconnect(sourceUri);
            }
            if (masterUri) {
                api.connectionSharing.disconnect(masterUri);
            }
            await fs.promises.rm(dacpacPath, { force: true }).catch(() => undefined);
        }
    });
});
