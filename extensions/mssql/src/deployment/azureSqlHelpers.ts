/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    AzureSqlDatabaseRequests,
    ContainerEngine,
    ContainerEnginePrerequisite,
    ContainerEnginePrerequisiteResult,
} from "../sharedInterfaces/azureSqlDatabase";
import { getErrorMessage } from "../utils/utils";
import { DeploymentWebviewController } from "./deploymentWebviewController";

const execFileAsync = promisify(execFile);

interface PrerequisiteCommand {
    executable: string;
    args: string[];
}

const prerequisiteCommands: Record<
    ContainerEngine,
    Partial<Record<ContainerEnginePrerequisite, PrerequisiteCommand>>
> = {
    [ContainerEngine.Docker]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "docker",
            args: ["--version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "docker",
            args: ["info"],
        },
        [ContainerEnginePrerequisite.Configuration]: {
            executable: "docker",
            args: ["info", "--format", "{{.OSType}}"],
        },
    },
    [ContainerEngine.Podman]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "podman",
            args: ["--version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "podman",
            args: ["info"],
        },
    },
    [ContainerEngine.Containerd]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "nerdctl",
            args: ["--version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "nerdctl",
            args: ["info"],
        },
    },
    [ContainerEngine.AppleContainer]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "container",
            args: ["--version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "container",
            args: ["system", "status"],
        },
    },
    [ContainerEngine.WslContainer]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "wslc",
            args: ["version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "wslc",
            args: ["container", "list"],
        },
    },
};

export function registerAzureSqlRpcHandlers(
    deploymentController: DeploymentWebviewController,
): void {
    deploymentController.onRequest(AzureSqlDatabaseRequests.DetectContainerEngines, async () =>
        detectContainerEngines(),
    );

    deploymentController.onRequest(
        AzureSqlDatabaseRequests.CheckContainerEnginePrerequisite,
        async (payload) => checkContainerEnginePrerequisite(payload.engine, payload.prerequisite),
    );
}

export async function detectContainerEngines(): Promise<
    Record<ContainerEngine, ContainerEnginePrerequisiteResult>
>;
export async function detectContainerEngines(
    checkPrerequisite: typeof checkContainerEnginePrerequisite,
): Promise<Record<ContainerEngine, ContainerEnginePrerequisiteResult>>;
export async function detectContainerEngines(
    checkPrerequisite = checkContainerEnginePrerequisite,
): Promise<Record<ContainerEngine, ContainerEnginePrerequisiteResult>> {
    const detectionResults = await Promise.all(
        Object.values(ContainerEngine).map(async (engine) => {
            const result = await checkPrerequisite(
                engine,
                ContainerEnginePrerequisite.Installation,
            );
            return [engine, result] as const;
        }),
    );

    return Object.fromEntries(detectionResults) as Record<
        ContainerEngine,
        ContainerEnginePrerequisiteResult
    >;
}

export async function checkContainerEnginePrerequisite(
    engine: ContainerEngine,
    prerequisite: ContainerEnginePrerequisite,
): Promise<ContainerEnginePrerequisiteResult> {
    const command = prerequisiteCommands[engine]?.[prerequisite];
    if (!command) {
        return { success: true };
    }

    try {
        const result = await execFileAsync(command.executable, command.args, {
            timeout: 15_000,
            windowsHide: true,
        });

        if (
            engine === ContainerEngine.Docker &&
            prerequisite === ContainerEnginePrerequisite.Configuration &&
            result.stdout.trim().toLowerCase() !== "linux"
        ) {
            return {
                success: false,
                error: `Docker is configured to use ${result.stdout.trim()} containers instead of Linux containers.`,
            };
        }

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: getErrorMessage(error),
        };
    }
}
