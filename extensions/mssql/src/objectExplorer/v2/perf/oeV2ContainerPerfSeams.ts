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
import { randomBytes } from "crypto";
import { Perf } from "../../../perf/perfTelemetry";
import { IConnectionProfile } from "../../../models/interfaces";
import {
    sqlAuthentication,
    sqlServerDockerRegistry,
    sqlServerDockerRepository,
} from "../../../constants/constants";
import { stableProfileId } from "../../../services/metadata/profileAuthAdapter";
import {
    checkContainerExists,
    checkDockerInstallation,
    checkEngine,
    deleteContainer,
    execDockerCommand,
    findAvailablePort,
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
    saveProfile(profile: IConnectionProfile): Promise<IConnectionProfile>;
    removeProfile(profile: IConnectionProfile): Promise<void>;
}

const CONTAINER_NAME = "mssql-perftest-oev2";
const IMAGE_VERSION = "2025";

interface PerfContainerState {
    containerName: string;
    port: number;
    password: string;
    profile?: IConnectionProfile;
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
    if (await checkContainerExists(CONTAINER_NAME)) {
        // Stale leftover from an aborted run: its password is gone with that
        // rep, so the container is useless — replace it.
        await deleteContainer(CONTAINER_NAME);
    }
    const port = await findAvailablePort(14330);
    if (port <= 0) {
        throw new Error("no free host port for the perf container");
    }
    // Upper + lower + digit + special, ≥3 classes, never logged.
    const password = `Pp1!${randomBytes(12).toString("base64url")}`;
    const created = await startSqlServerDockerContainer(
        CONTAINER_NAME,
        password,
        IMAGE_VERSION,
        "",
        port,
    );
    if (!created.success) {
        throw new Error(`container create failed: ${created.error}`);
    }
    const ready = await checkIfSqlServerContainerIsReadyForConnections(CONTAINER_NAME);
    if (!ready.success) {
        throw new Error(`container never became ready: ${ready.error}`);
    }
    return { containerName: CONTAINER_NAME, port, password };
}

function containerProfile(current: PerfContainerState): IConnectionProfile {
    return {
        profileName: CONTAINER_NAME,
        containerName: CONTAINER_NAME,
        version: IMAGE_VERSION,
        server: `localhost,${current.port}`,
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

async function connectThroughOeV2(profile: IConnectionProfile): Promise<void> {
    const connected = await vscode.commands.executeCommand<boolean>(
        "mssql.objectExplorerV2.connectProfileById",
        connectionIdOf(profile),
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
    context.subscriptions.push(
        vscode.commands.registerCommand("mssql.perf.oeV2ContainerDeploy", async () => {
            await ensureDockerReady();
            state = await provisionContainer();
            state.profile = await host.saveProfile(containerProfile(state));
            await connectThroughOeV2(state.profile);
            return { port: state.port };
        }),
        vscode.commands.registerCommand("mssql.perf.oeV2ContainerReconnectSetup", async () => {
            await ensureDockerReady();
            state = await provisionContainer();
            state.profile = await host.saveProfile(containerProfile(state));
            // Drive the connect to completion HERE — saving a new profile
            // fires the single-new-profile auto-connect, which would otherwise
            // race the measured reconnect (its background container restart
            // trips the measure's `alreadyRunning` pre-flight short-circuit,
            // opening against a still-booting SQL Server). Connecting then
            // disconnecting deterministically absorbs that auto-connect, so the
            // measurement starts from a true disconnected + stopped state and
            // exercises a real cold restart → readiness → open.
            await connectThroughOeV2(state.profile);
            await disconnectThroughOeV2(state.profile);
            const stopped = await stopContainer(state.containerName);
            if (!stopped) {
                throw new Error("could not stop the perf container before the measurement");
            }
            return { port: state.port };
        }),
        vscode.commands.registerCommand("mssql.perf.oeV2ContainerReconnect", async () => {
            if (!state?.profile) {
                throw new Error("reconnect setup did not run");
            }
            // The DOCK-3 pre-flight starts the stopped container (docker
            // start → readiness) BEFORE the data-plane open — this window is
            // exactly the user's expand-a-stopped-container wait.
            await connectThroughOeV2(state.profile);
            return { port: state.port };
        }),
        vscode.commands.registerCommand("mssql.perf.oeV2ContainerCleanup", async () => {
            const current = state;
            state = undefined;
            if (!current) {
                return;
            }
            await deleteContainer(current.containerName);
            if (current.profile) {
                await host.removeProfile(current.profile).catch(() => undefined);
            }
        }),
    );
}
