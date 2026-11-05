/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * PERF_MODE-only container scenario seams (DOCK-4). Two measured paths over
 * the SHARED docker core + the OE v2 data plane:
 *
 *  - oeV2ContainerDeploy: create container → readiness → save profile →
 *    v2 connect (the DOCK-1 wizard-terminal path, headless).
 *  - oeV2ContainerReconnect(+Setup): a STOPPED container profile connects
 *    through the DOCK-3 pre-flight (docker start → readiness → open) — the
 *    exact expand-a-stopped-container wait a user sees.
 *
 * Every honesty failure THROWS so the harness records a real error. The
 * seams require a locally CACHED SQL Server image (they never pull —
 * multi-GB pulls have no place inside a perf rep) and clean up their
 * container + profile. SA passwords are generated per rep and never logged.
 */

import * as vscode from "vscode";
import { randomBytes, randomUUID } from "crypto";
import { Perf } from "../../../perf/perfTelemetry";
import { IConnectionProfile } from "../../../models/interfaces";
import {
    sqlAuthentication,
    sqlServerDockerRegistry,
    sqlServerDockerRepository,
} from "../../../constants/constants";
import { stableProfileId } from "../../../services/metadata/profileAuthAdapter";
import {
    checkDockerInstallation,
    checkEngine,
    deleteContainer,
    execDockerCommand,
    findAvailablePort,
    getContainerByName,
    startDocker,
    stopContainer,
} from "../../../docker/dockerUtils";
import {
    checkIfSqlServerContainerIsReadyForConnections,
    constructVersionTag,
    startSqlServerDockerContainer,
} from "../../../deployment/sqlServerContainer";

/** Profile persistence seam (mainController supplies the classic store). */
export interface ContainerPerfHost {
    isEnabled(): boolean;
    saveProfile(profile: IConnectionProfile): Promise<IConnectionProfile>;
    removeProfile(profile: IConnectionProfile): Promise<void>;
}

const IMAGE_VERSION = "2025";

interface PerfContainerState {
    containerName: string;
    port: number;
    password: string;
    profile?: IConnectionProfile;
    deleted?: boolean;
}

let state: PerfContainerState | undefined;

async function ensureDockerReady(): Promise<void> {
    const install = await checkDockerInstallation();
    if (!install.success) {
        throw new Error(`docker unavailable: ${install.error}`);
    }
    const started = await startDocker();
    if (!started.success) {
        throw new Error(`docker engine not running: ${started.error}`);
    }
    const engine = await checkEngine();
    if (!engine.success) {
        throw new Error(`docker engine misconfigured: ${engine.error}`);
    }
    const image = `${sqlServerDockerRegistry}/${sqlServerDockerRepository}:${constructVersionTag(IMAGE_VERSION)}`;
    const cached = await execDockerCommand({ command: "docker", args: ["images", "-q", image] });
    if (cached.trim().length === 0) {
        throw new Error(
            `SQL Server image is not cached — run "docker pull ${image}" once before container scenarios`,
        );
    }
}

async function provisionContainer(): Promise<PerfContainerState> {
    if (state) throw new Error("Clean up the previous container scenario before starting another.");
    const containerName = `mssql-perftest-oev2-${randomUUID()}`;
    const port = await findAvailablePort(14330);
    if (port <= 0) {
        throw new Error("no free host port for the perf container");
    }
    // Upper + lower + digit + special, ≥3 classes, never logged.
    const password = `Pp1!${randomBytes(12).toString("base64url")}`;
    // Retain ownership even if creation/readiness fails, so cleanup can
    // remove this run's container without touching another test host.
    const current = { containerName, port, password };
    state = current;
    const created = await startSqlServerDockerContainer(
        containerName,
        password,
        IMAGE_VERSION,
        "",
        port,
    );
    if (!created.success) {
        throw new Error(`container create failed: ${created.error}`);
    }
    const ready = await checkIfSqlServerContainerIsReadyForConnections(containerName);
    if (!ready.success) {
        throw new Error(`container never became ready: ${ready.error}`);
    }
    return current;
}

function containerProfile(current: PerfContainerState): IConnectionProfile {
    return {
        profileName: current.containerName,
        containerName: current.containerName,
        version: IMAGE_VERSION,
        // Use the published IPv4 endpoint explicitly: some local engines do
        // not forward the IPv6 address that localhost resolves to on Windows.
        server: `127.0.0.1,${current.port}`,
        user: "sa",
        password: current.password,
        savePassword: true,
        emptyPasswordInput: false,
        authenticationType: sqlAuthentication,
        trustServerCertificate: true,
    } as unknown as IConnectionProfile;
}

function connectionIdOf(profile: IConnectionProfile): string {
    return stableProfileId(profile as unknown as Parameters<typeof stableProfileId>[0]);
}

async function connectThroughOeV2(
    profile: IConnectionProfile,
    freshContainer = false,
): Promise<void> {
    const connected = await vscode.commands.executeCommand<boolean>(
        "mssql.objectExplorerV2.connectProfileById",
        connectionIdOf(profile),
        freshContainer ? { password: state?.password, freshContainer: true } : undefined,
    );
    if (connected !== true) {
        throw new Error("OE v2 could not connect to the container through the data plane");
    }
}

/**
 * Drives the v2 session to a clean disconnected state by connectionId. The
 * disconnect command reads `node.connectionId`, so a bare id-carrying node is
 * all it needs.
 */
async function disconnectThroughOeV2(profile: IConnectionProfile): Promise<void> {
    await vscode.commands.executeCommand("mssql.objectExplorerV2.disconnect", {
        connectionId: connectionIdOf(profile),
    });
}

export function registerOeV2ContainerPerfSeams(
    context: vscode.ExtensionContext,
    host: ContainerPerfHost,
): void {
    if (!Perf.enabled) {
        return;
    }
    const requireEnabled = () => {
        if (!host.isEnabled()) throw new Error("Object Explorer v2 private preview is disabled.");
    };
    const cleanup = async () => {
        const current = state;
        if (!current) return;
        const errors: unknown[] = [];
        if (current.profile) {
            try {
                await disconnectThroughOeV2(current.profile);
            } catch (error) {
                errors.push(error);
            }
        }
        // A failed disconnect must not strand the container. Retain ownership
        // until deletion succeeds so cleanup can be retried after a failure.
        try {
            current.deleted ||= await deleteContainer(current.containerName);
            // A failed create can leave no container to delete. Distinguish
            // confirmed absence from an engine error, which must stay owned.
            current.deleted ||= (await getContainerByName(current.containerName)) === undefined;
        } catch (error) {
            errors.push(error);
        }
        if (!current.deleted) {
            errors.push(new Error("Could not delete the owned performance test container."));
        } else {
            if (current.profile) {
                try {
                    await host.removeProfile(current.profile);
                    current.profile = undefined;
                } catch (error) {
                    errors.push(error);
                }
            }
            if (!current.profile) state = undefined;
        }
        if (errors.length) throw new AggregateError(errors, "Container scenario cleanup failed.");
    };
    const run = async (action: () => Promise<{ port: number }>) => {
        requireEnabled();
        try {
            return await action();
        } catch (error) {
            // The scenario engine's normal cleanup steps only run on success.
            // Clean up here as well when provisioning or connecting fails.
            try {
                await cleanup();
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], "Container scenario failed.");
            }
            throw error;
        }
    };
    context.subscriptions.push(
        vscode.commands.registerCommand("mssql.perf.oeV2ContainerDeploy", () =>
            run(async () => {
                await ensureDockerReady();
                state = await provisionContainer();
                state.profile = await host.saveProfile(containerProfile(state));
                await connectThroughOeV2(state.profile, true);
                return { port: state.port };
            }),
        ),
        vscode.commands.registerCommand("mssql.perf.oeV2ContainerReconnectSetup", () =>
            run(async () => {
                await ensureDockerReady();
                state = await provisionContainer();
                state.profile = await host.saveProfile(containerProfile(state));
                // Connect and disconnect during setup so the measurement starts
                // from a saved, verified profile and a truly stopped container.
                await connectThroughOeV2(state.profile, true);
                await disconnectThroughOeV2(state.profile);
                const stopped = await stopContainer(state.containerName);
                if (!stopped) {
                    throw new Error("could not stop the perf container before the measurement");
                }
                return { port: state.port };
            }),
        ),
        vscode.commands.registerCommand("mssql.perf.oeV2ContainerReconnect", () =>
            run(async () => {
                if (!state?.profile) {
                    throw new Error("reconnect setup did not run");
                }
                // The DOCK-3 pre-flight starts the stopped container (docker
                // start → readiness) BEFORE the data-plane open — this window is
                // exactly the user's expand-a-stopped-container wait.
                await connectThroughOeV2(state.profile);
                return { port: state.port };
            }),
        ),
        vscode.commands.registerCommand("mssql.perf.oeV2ContainerCleanup", cleanup),
    );
}
