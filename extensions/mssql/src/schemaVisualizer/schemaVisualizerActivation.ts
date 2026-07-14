/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Schema Visualizer activation (SV-R4). Preview surface gated on
 * `mssql.schemaVisualizer.enabled` + `mssql.sqlDataPlane.enabled` (the OE
 * v2 gating chain — D7). Entry points: command palette and the OE v2
 * database-node context menu (visibility via package.json `when` clauses).
 * Connection identity resolves from SAVED PROFILES through the data-plane
 * profile adapter — never ConnectionManager (§3.2); one panel per
 * (stableProfileId | serverFingerprint | database) non-secret key (§8.2).
 */

import * as vscode from "vscode";
import { Perf } from "../perf/perfTelemetry";
import { MetadataStoreService } from "../services/metadata/metadataStoreService";
import {
    PreparedConnection,
    prepareConnection,
    ProfileSecretSource,
    ProfileTokenSource,
    stableProfileId,
} from "../services/metadata/profileAuthAdapter";
import { SqlDataPlaneService } from "../services/sqlDataPlane/sqlDataPlaneService";
import {
    ConnectionProfileSource,
    readProfileTree,
} from "../objectExplorer/v2/sessions/oeV2ProfileAdapter";
import { SchemaVisualizerWebviewController } from "./schemaVisualizerController";
import {
    ClassicConnectionSeam,
    confirmClassicHandoff,
    createClassicPublishResolver,
    legacyPortOverService,
} from "./handoff/classicPublishResolver";
import { IConnectionProfile } from "../models/interfaces";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";

export interface SchemaVisualizerActivationDeps {
    readonly profiles: ConnectionProfileSource & ProfileSecretSource;
    readonly tokens: ProfileTokenSource;
    /** Publish handoff seams (§8.1); absent = read-only preview host. */
    readonly publish?: {
        readonly service: SchemaDesigner.ISchemaDesignerService;
        readonly connections: ClassicConnectionSeam;
    };
}

export function schemaVisualizerEnabled(): boolean {
    const configuration = vscode.workspace.getConfiguration();
    return (
        configuration.get<boolean>("mssql.schemaVisualizer.enabled", false) &&
        configuration.get<boolean>("mssql.sqlDataPlane.enabled", false)
    );
}

/** Non-secret panel key (§8.2) — NEVER a connection string. */
function panelKey(profileId: string, prepared: PreparedConnection, database: string): string {
    return `${profileId}|${prepared.serverFingerprint}|${database}|readOnly`;
}

export function activateSchemaVisualizer(
    context: vscode.ExtensionContext,
    deps: SchemaVisualizerActivationDeps,
): void {
    const panels = new Map<string, SchemaVisualizerWebviewController>();

    const openVisualizer = async (profileId: string, database: string): Promise<void> => {
        const tree = await readProfileTree(deps.profiles);
        const record = tree.profiles.find((profile) => profile.profileId === profileId);
        if (!record) {
            void vscode.window.showErrorMessage(
                "Schema Visualizer could not find the saved connection profile.",
            );
            return;
        }
        const prepared = prepareConnection(record.stored, deps.profiles, deps.tokens);
        const key = panelKey(profileId, prepared, database);
        const existing = panels.get(key);
        if (existing) {
            existing.revealToForeground();
            return;
        }
        const controller = new SchemaVisualizerWebviewController(context, {
            store: MetadataStoreService.get().store(),
            prepared,
            database,
            displayName: record.displayName,
            ...(deps.publish !== undefined
                ? {
                      publish: {
                          resolver: createClassicPublishResolver({
                              connections: deps.publish.connections,
                              storedProfile: record.stored as IConnectionProfile,
                              confirm: confirmClassicHandoff,
                          }),
                          legacy: legacyPortOverService(deps.publish.service),
                      },
                  }
                : {}),
        });
        panels.set(key, controller);
        controller.onDisposed(() => panels.delete(key));
        controller.revealToForeground();
    };

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql.schemaVisualizer.open",
            async (node?: { connectionId?: string; database?: string }) => {
                if (!schemaVisualizerEnabled()) {
                    void vscode.window.showInformationMessage(
                        "Enable mssql.schemaVisualizer.enabled and mssql.sqlDataPlane.enabled to use the Schema Visualizer preview.",
                    );
                    return;
                }
                // OE v2 database node: identity rides the node.
                if (node?.connectionId && node.database) {
                    await openVisualizer(node.connectionId, node.database);
                    return;
                }
                // Command palette: pick a saved profile, then a database name.
                const tree = await readProfileTree(deps.profiles);
                if (tree.profiles.length === 0) {
                    void vscode.window.showInformationMessage(
                        "No saved connection profiles found.",
                    );
                    return;
                }
                const pickedProfile = await vscode.window.showQuickPick(
                    tree.profiles.map((profile) => ({
                        label: profile.displayName,
                        description: profile.server,
                        profile,
                    })),
                    { title: "Visualize Schema: pick a connection" },
                );
                if (!pickedProfile) {
                    return;
                }
                const database = await vscode.window.showInputBox({
                    title: "Visualize Schema: database",
                    value: pickedProfile.profile.database ?? "",
                    prompt: "Database to visualize",
                    validateInput: (value) => (value.trim().length === 0 ? "Required" : undefined),
                });
                if (!database) {
                    return;
                }
                await openVisualizer(
                    stableProfileId(pickedProfile.profile.stored),
                    database.trim(),
                );
            },
        ),
        {
            dispose: () => {
                for (const controller of panels.values()) {
                    controller.dispose();
                }
                panels.clear();
            },
        },
    );

    // PERF_MODE-only open probe (OE v2 probe pattern): opens the visualizer
    // for the single provisioned profile without interactive pickers, so the
    // schema-visualizer-open scenario is pure command + waitForMarker.
    if (Perf.enabled) {
        context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.perf.schemaVisualizerOpen",
                async (args?: { database?: string }) => {
                    const tree = await readProfileTree(deps.profiles);
                    const record = tree.profiles[0];
                    if (!record) {
                        throw new Error("no saved profile visible for the visualizer probe");
                    }
                    const database = args?.database ?? record.database;
                    if (!database) {
                        throw new Error("provisioned profile carries no database");
                    }
                    await openVisualizer(record.profileId, database);
                },
            ),
        );
    }
    // Availability guard is informational only: the command stays registered
    // so palette invocations explain the required settings instead of
    // failing silently; menu visibility is config-gated in package.json.
    void SqlDataPlaneService;
}
