/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Drives a DAB CLI deployment across its steps.
 *
 * The wizard runs one step per request, so the CLI package, the resolved
 * runtime, and the launched engine's output accessor are held here between
 * calls. One runner belongs to one designer session.
 */

import { spawn } from "child_process";
import * as fsPromises from "fs/promises";
import * as path from "path";
import DotnetRuntimeProvider from "../languageservice/dotnetRuntimeProvider";
import { LocalContainers } from "../constants/locConstants";
import { ILogger } from "../sharedInterfaces/logger";
import { Dab } from "../sharedInterfaces/dab";
import { getErrorMessage } from "../utils/utils";
import { acquireDabCli, DabCliAcquisitionError, DabCliInstallation } from "./dabCliTool";
import {
    checkDabCliEngineReady,
    DabCliProcessEnvironment,
    runDabCliCommand,
    startDabCliEngine,
} from "./dabCliProcess";

/** Where to send a user who has no usable .NET runtime. */
export const dotnetDownloadLink = "https://dotnet.microsoft.com/download";

/**
 * Azure CLI install instructions for this machine.
 *
 * The pages differ per platform — winget on Windows, Homebrew on macOS, a
 * package manager on Linux — so one shared link would leave most readers
 * translating steps for an operating system they are not on. The locale
 * segment is left out so the page opens in the reader's own language.
 */
export function getAzureCliInstallLink(): string {
    const base = "https://learn.microsoft.com/cli/azure";
    if (process.platform === "win32") {
        return `${base}/install-azure-cli-windows?view=azure-cli-latest&pivots=winget`;
    }

    return process.platform === "darwin"
        ? `${base}/install-azure-cli-macos?view=azure-cli-latest`
        : `${base}/install-azure-cli-linux?view=azure-cli-latest`;
}

/**
 * The engine reports every failure to open a database connection with this
 * sentence, and reports nothing else with it, so it distinguishes a connection
 * problem the user can fix from a configuration problem they cannot.
 *
 * Matched as written because the engine emits it from a constant in English
 * and does not localize its output.
 */
const DAB_CONNECTION_FAILURE_MARKER = "A valid Connection String should be provided.";

/** True when the CLI's output says it could not open a database connection. */
export function isDatabaseConnectionFailure(output: string | undefined): boolean {
    return !!output?.includes(DAB_CONNECTION_FAILURE_MARKER);
}

/** File name the generated config is written as, matching DAB's convention. */
export const DAB_CLI_CONFIG_FILE_NAME = "dab-config.json";

export class DabCliRunner {
    private _installation: DabCliInstallation | undefined;
    private _dotnetPath: string | undefined;
    private _getEngineLogs: (() => string) | undefined;

    constructor(
        private readonly storagePath: string,
        private readonly logger: ILogger,
    ) {}

    /**
     * Downloads and unpacks the pinned DAB CLI, or reuses an unpacked copy.
     */
    public async acquireCli(): Promise<Dab.RunDeploymentStepResponse> {
        try {
            this._installation = await acquireDabCli(this.storagePath, this.logger);
            return { success: true };
        } catch (error) {
            // The dialog shows a short summary, so the cause is logged here as
            // well; otherwise the only record of it is a field on the response.
            this.logger.error(
                `Could not acquire the Data API builder CLI: ${getErrorMessage(error)}`,
            );

            return {
                success: false,
                error: this.getAcquisitionErrorMessage(error),
                fullErrorText: getErrorMessage(error),
            };
        }
    }

    /**
     * The sentence to show for a failed acquisition.
     *
     * Each stage fails for its own reason, and naming the wrong one sends
     * people to check something that was never the problem: a network check
     * does not help when the machine's architecture has no build at all.
     */
    private getAcquisitionErrorMessage(error: unknown): string {
        if (!(error instanceof DabCliAcquisitionError)) {
            return LocalContainers.dabCliPrepareFailed;
        }

        switch (error.stage) {
            case "download":
                return LocalContainers.dabCliDownloadFailed;
            case "unsupported":
                return error.runtimeIdentifier
                    ? LocalContainers.dabCliArchitectureUnsupported(error.runtimeIdentifier)
                    : LocalContainers.dabCliPrepareFailed;
            default:
                return LocalContainers.dabCliPrepareFailed;
        }
    }

    /**
     * Resolves a .NET runtime able to run the acquired CLI.
     *
     * The extension's own runtime acquisition is tried first, so the engine runs
     * on the same managed runtime as SQL Tools Service. A dotnet already on the
     * machine is the fallback; when neither is available the user is asked to
     * install .NET, because nothing here can install it for them.
     */
    public async resolveRuntime(): Promise<Dab.RunDeploymentStepResponse> {
        if (!this._installation) {
            return { success: false, error: LocalContainers.dabCliNotAcquired };
        }

        try {
            const runtimeProvider = new DotnetRuntimeProvider(this.logger);
            this._dotnetPath = await runtimeProvider.acquireDotnetRuntime(
                this._installation.runtimeConfigPath,
            );
            return { success: true };
        } catch (error) {
            this.logger.warn(
                `Could not acquire a .NET runtime for the DAB CLI: ${getErrorMessage(error)}`,
            );
        }

        const systemDotnetPath = await findDotnetOnPath();
        if (systemDotnetPath) {
            this._dotnetPath = systemDotnetPath;
            this.logger.info(`Using the .NET runtime found on PATH: ${systemDotnetPath}`);
            return { success: true };
        }

        return {
            success: false,
            error: LocalContainers.dabCliDotnetNotFound,
            errorLink: dotnetDownloadLink,
            errorLinkText: LocalContainers.dabCliInstallDotnet,
        };
    }

    /**
     * Writes the generated config and asks the CLI to validate it, so a bad
     * config is reported before an engine is launched against it.
     *
     * @param configPath Where to write the config file
     * @param configContent Generated DAB config, with the connection string as an @env reference
     * @param environment Port and connection string for the CLI process
     * @param authenticationType Authentication type of the connection, used to
     * explain a failure to connect in terms the user can act on
     */
    public async validateConfig(
        configPath: string,
        configContent: string,
        environment: DabCliProcessEnvironment,
        authenticationType?: string,
    ): Promise<Dab.RunDeploymentStepResponse> {
        const readiness = this.getRunnableCli();
        if (!readiness.cli) {
            return readiness.error;
        }

        try {
            await fsPromises.mkdir(path.dirname(configPath), { recursive: true });
            await fsPromises.writeFile(configPath, configContent, {
                encoding: "utf8",
                mode: 0o600,
            });
        } catch (error) {
            return {
                success: false,
                error: LocalContainers.dabCliConfigWriteFailed,
                fullErrorText: getErrorMessage(error),
            };
        }

        const result = await runDabCliCommand(
            readiness.cli.dotnetPath,
            readiness.cli.assemblyPath,
            ["validate", "--config", configPath],
            environment,
        );

        if (result.success) {
            return { success: true };
        }

        // A configuration the engine cannot validate and a database it cannot
        // reach are different problems: one needs the config changed, the other
        // needs the connection fixed and the step run again.
        if (isDatabaseConnectionFailure(result.engineLogs)) {
            const isEntra = Dab.isEntraAuthentication(authenticationType);
            return {
                success: false,
                error: isEntra
                    ? LocalContainers.dabCliEntraConnectionFailed
                    : LocalContainers.dabCliDatabaseConnectionFailed,
                ...(isEntra
                    ? {
                          errorLink: getAzureCliInstallLink(),
                          errorLinkText: LocalContainers.dabCliInstallAzureCli,
                      }
                    : {}),
                fullErrorText: result.fullErrorText ?? result.error,
                containerLogs: result.engineLogs,
            };
        }

        return {
            success: false,
            error: LocalContainers.dabCliConfigInvalid,
            fullErrorText: result.fullErrorText ?? result.error,
            containerLogs: result.engineLogs,
        };
    }

    /**
     * Launches the engine against a config that has already been written.
     *
     * @param configPath Config file the engine should load
     * @param environment Port and connection string for the engine process
     */
    public async startEngine(
        configPath: string,
        environment: DabCliProcessEnvironment,
    ): Promise<Dab.RunDeploymentStepResponse & { processId?: number }> {
        const readiness = this.getRunnableCli();
        if (!readiness.cli) {
            return readiness.error;
        }

        const result = await startDabCliEngine(
            readiness.cli.dotnetPath,
            readiness.cli.assemblyPath,
            configPath,
            environment,
        );

        if (!result.success) {
            return {
                success: false,
                error: LocalContainers.dabCliStartFailed,
                fullErrorText: result.fullErrorText ?? result.error,
            };
        }

        this._getEngineLogs = result.getLogs;
        return {
            success: true,
            processId: result.processId,
            apiUrl: `http://localhost:${environment.port}`,
        };
    }

    /**
     * Waits for the engine launched by {@link startEngine} to answer.
     *
     * @param port Port the engine publishes on
     */
    public async checkEngine(port: number): Promise<Dab.RunDeploymentStepResponse> {
        const result = await checkDabCliEngineReady(port, this._getEngineLogs);
        if (result.success) {
            return { success: true, apiUrl: `http://localhost:${port}` };
        }

        return {
            success: false,
            error: LocalContainers.dabCliEngineNotReady,
            fullErrorText: result.fullErrorText,
            containerLogs: result.engineLogs,
        };
    }

    /**
     * The CLI and runtime needed to run a command, or the step failure that
     * explains which prerequisite has not run yet.
     */
    private getRunnableCli():
        | { cli: { dotnetPath: string; assemblyPath: string }; error?: never }
        | { cli?: never; error: Dab.RunDeploymentStepResponse } {
        if (!this._installation) {
            return { error: { success: false, error: LocalContainers.dabCliNotAcquired } };
        }

        if (!this._dotnetPath) {
            return { error: { success: false, error: LocalContainers.dabCliDotnetNotResolved } };
        }

        return {
            cli: {
                dotnetPath: this._dotnetPath,
                assemblyPath: this._installation.assemblyPath,
            },
        };
    }
}

/**
 * Returns the path of a working `dotnet` on PATH, or undefined when there is none.
 */
async function findDotnetOnPath(): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
        try {
            const child = spawn("dotnet", ["--version"], { windowsHide: true });
            child.on("error", () => resolve(undefined));
            child.on("close", (code) => resolve(code === 0 ? "dotnet" : undefined));
        } catch {
            resolve(undefined);
        }
    });
}
