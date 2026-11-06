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
    DabAzureCli,
    DabAzureCliInstallError,
    DabAzureCliResolution,
    DabAzureCliSignIn,
} from "./dabAzureCli";
import {
    checkDabCliEngineReady,
    DabCliProcessEnvironment,
    startDabCliEngine,
} from "./dabCliProcess";

/** Where to send a user who has no usable .NET runtime. */
export const dotnetDownloadLink = "https://dotnet.microsoft.com/download";

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
    /** Pid of the engine this runner launched, used to confirm what answers on the port. */
    private _launchedProcessId: number | undefined;
    private readonly _azureCli: DabAzureCli;
    private _azureCliResolution: DabAzureCliResolution | undefined;
    /** A sign-in waiting for the user to finish it in a browser. */
    private _pendingSignIn: DabAzureCliSignIn | undefined;

    constructor(
        private readonly storagePath: string,
        private readonly logger: ILogger,
        azureCli?: DabAzureCli,
    ) {
        this._azureCli = azureCli ?? new DabAzureCli(storagePath, logger);
    }

    /**
     * Gets the CLI and the .NET runtime to run it with, as one step: the
     * package names the runtime it needs, so the two always go together.
     */
    public async prepareCli(): Promise<Dab.RunDeploymentStepResponse> {
        const acquireResult = await this.acquireCli();
        if (!acquireResult.success) {
            return acquireResult;
        }

        const runtimeResult = await this.resolveRuntime();
        if (!runtimeResult.success) {
            return runtimeResult;
        }

        return {
            success: true,
            detail: LocalContainers.dabCliReady(this._installation?.version ?? Dab.DAB_CLI_VERSION),
        };
    }

    /**
     * Gets the private Azure CLI the engine signs in to Microsoft Entra with,
     * installing it the first time.
     *
     * @param onProgress Called as the download, unpack, or install moves on
     */
    public async prepareAzureCli(
        onProgress?: (progress: Dab.DabDeploymentStepProgress) => void,
    ): Promise<Dab.RunDeploymentStepResponse> {
        try {
            this._azureCliResolution = await this._azureCli.install((progress) =>
                onProgress?.(progress.phase === "pip" ? { phase: "install" } : progress),
            );
        } catch (error) {
            this.logger.error(`Could not set up the Azure CLI: ${getErrorMessage(error)}`);
            const needsPython =
                error instanceof DabAzureCliInstallError && error.stage === "python";
            return {
                success: false,
                error: getAzureCliInstallErrorMessage(error),
                fullErrorText: getErrorMessage(error),
                ...(needsPython
                    ? {
                          errorLink: pythonDownloadLink,
                          errorLinkText: LocalContainers.dabAzureCliInstallPython,
                      }
                    : {}),
            };
        }

        return { success: true, detail: LocalContainers.dabAzureCliPrivateReady };
    }

    /**
     * Signs the Azure CLI in to Microsoft Entra.
     *
     * Without an action, a sign-in the Azure CLI already holds is reused, and
     * otherwise the step waits for the user. A browser sign-in finishes in one
     * request. A device code sign-in takes two: the first reports the code, and
     * the second waits for the user to enter it.
     *
     * @param action What the user chose, if anything yet
     * @param entra Tenant and account the connection signs in with
     */
    public async signInEntra(
        action: Dab.DabDeploymentStepAction | undefined,
        entra: { tenantId?: string; account?: string },
    ): Promise<Dab.RunDeploymentStepResponse> {
        const resolution = this._azureCliResolution ?? (await this._azureCli.resolve());
        if (!resolution) {
            return { success: false, error: LocalContainers.dabAzureCliNotReady };
        }
        this._azureCliResolution = resolution;
        const signInPrompt: Dab.RunDeploymentStepResponse = {
            success: false,
            prompt: { kind: "entraSignIn", account: entra.account },
        };

        switch (action) {
            case Dab.DabDeploymentStepAction.SignIn: {
                this.cancelSignIn();
                const signIn = this._azureCli.signIn(resolution, { tenantId: entra.tenantId });
                this._pendingSignIn = signIn;
                return this.finishSignIn(signIn, resolution, entra);
            }

            case Dab.DabDeploymentStepAction.SignInWithCode: {
                this.cancelSignIn();
                const signIn = this._azureCli.signIn(resolution, {
                    tenantId: entra.tenantId,
                    useDeviceCode: true,
                });
                this._pendingSignIn = signIn;
                const deviceCode = await signIn.deviceCode;
                if (!deviceCode) {
                    const completion = await signIn.completion;
                    return {
                        success: false,
                        error: LocalContainers.dabEntraSignInCodeUnavailable,
                        fullErrorText: completion.error,
                    };
                }

                return {
                    success: false,
                    prompt: { kind: "entraDeviceCode", account: entra.account, ...deviceCode },
                };
            }

            case Dab.DabDeploymentStepAction.AwaitSignIn: {
                const signIn = this._pendingSignIn;
                return signIn ? this.finishSignIn(signIn, resolution, entra) : signInPrompt;
            }

            default: {
                const signedIn = await this._azureCli.getSignedInAccount(
                    resolution,
                    entra.tenantId,
                );
                return signedIn
                    ? { success: true, detail: getSignedInDetail(signedIn.account) }
                    : signInPrompt;
            }
        }
    }

    /** Stops a sign-in the user walked away from. */
    public cancelSignIn(): void {
        this._pendingSignIn?.cancel();
        this._pendingSignIn = undefined;
    }

    private async finishSignIn(
        signIn: DabAzureCliSignIn,
        resolution: DabAzureCliResolution,
        entra: { tenantId?: string },
    ): Promise<Dab.RunDeploymentStepResponse> {
        const completion = await signIn.completion;
        if (this._pendingSignIn === signIn) {
            this._pendingSignIn = undefined;
        }

        // A clean exit from the login is not the test: the engine needs a
        // database token for this tenant, so that is what is checked.
        const signedIn = completion.success
            ? await this._azureCli.getSignedInAccount(resolution, entra.tenantId)
            : undefined;
        if (!signedIn) {
            return {
                success: false,
                error: LocalContainers.dabEntraSignInFailed,
                fullErrorText: completion.error,
            };
        }

        return { success: true, detail: getSignedInDetail(signedIn.account) };
    }

    /**
     * Variables the engine needs to sign in through the Azure CLI, resolving
     * the Azure CLI first when this session has not set it up yet.
     */
    public async getAzureCliEnvironment(): Promise<NodeJS.ProcessEnv | undefined> {
        this._azureCliResolution ??= await this._azureCli.resolve();
        return this._azureCliResolution?.environment;
    }

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
     * Writes the generated config for the engine to start from.
     *
     * The config is not run through `dab validate` first: validation loads
     * the metadata of every entity from the database, one entity at a time,
     * and starting the engine loads it all again. On a large database that
     * doubles a wait of several minutes, and starting reports the same errors.
     *
     * @param configPath Where to write the config file
     * @param configContent Generated DAB config, with the connection string as an @env reference
     */
    public async writeConfig(
        configPath: string,
        configContent: string,
    ): Promise<Dab.RunDeploymentStepResponse> {
        try {
            await fsPromises.mkdir(path.dirname(configPath), { recursive: true });
            await fsPromises.writeFile(configPath, configContent, {
                encoding: "utf8",
                mode: 0o600,
            });
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: LocalContainers.dabCliConfigWriteFailed,
                fullErrorText: getErrorMessage(error),
            };
        }
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
        this._launchedProcessId = result.processId;
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
     * @param processId Engine process id, when the caller tracked one itself
     */
    public async checkEngine(
        port: number,
        processId?: number,
        options: {
            authenticationType?: string;
            onProgress?: (progress: Dab.DabDeploymentStepProgress) => void;
        } = {},
    ): Promise<Dab.RunDeploymentStepResponse> {
        const result = await checkDabCliEngineReady(
            port,
            this._getEngineLogs,
            processId ?? this._launchedProcessId,
            (elapsedMs) =>
                options.onProgress?.({
                    phase: "starting",
                    elapsedSeconds: Math.floor(elapsedMs / 1000),
                }),
        );
        if (result.success) {
            return { success: true, apiUrl: `http://localhost:${port}` };
        }

        // An engine that cannot reach the database needs the connection fixed,
        // not the configuration, so that failure gets a message of its own.
        if (isDatabaseConnectionFailure(result.engineLogs)) {
            return {
                success: false,
                error: Dab.isEntraAuthentication(options.authenticationType)
                    ? LocalContainers.dabCliEntraConnectionFailed
                    : LocalContainers.dabCliDatabaseConnectionFailed,
                fullErrorText: result.fullErrorText ?? result.error,
                containerLogs: result.engineLogs,
            };
        }

        return {
            success: false,
            error: result.error ?? LocalContainers.dabCliEngineNotReady,
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

/** Where to send a user who needs Python for the private Azure CLI on macOS or Linux. */
export const pythonDownloadLink = "https://www.python.org/downloads/";

function getSignedInDetail(account: string | undefined): string {
    return account ? LocalContainers.dabEntraSignedInAs(account) : LocalContainers.dabEntraSignedIn;
}

/** The sentence to show for a private Azure CLI that could not be set up. */
function getAzureCliInstallErrorMessage(error: unknown): string {
    if (!(error instanceof DabAzureCliInstallError)) {
        return LocalContainers.dabAzureCliInstallFailed;
    }

    switch (error.stage) {
        case "download":
            return LocalContainers.dabAzureCliDownloadFailed;
        case "python":
            return LocalContainers.dabAzureCliPythonMissing;
        default:
            return LocalContainers.dabAzureCliInstallFailed;
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
