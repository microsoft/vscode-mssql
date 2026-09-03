/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DefaultSqlPortNumber } from "../constants/constants";
import { DabConfigFileBuilder } from "../dab/dabConfigFileBuilder";
import {
    checkDockerInstallation,
    checkEngine,
    dockerInstallErrorLink,
    dockerLogger,
    getEngineErrorLink,
    getEngineErrorLinkText,
    startDocker,
} from "../docker/dockerUtils";
import {
    checkIfDabContainerIsReady,
    findAvailableDabPort,
    getDabContainerStatus,
    isDabPortAvailable,
    pullDabContainerImage,
    startDabContainer,
    startDabDockerContainer,
    stopAndRemoveDabContainer,
    stopDabContainer,
    validateDabContainerName,
} from "../dab/dabContainer";
import { DabCliRunner, DAB_CLI_CONFIG_FILE_NAME } from "../dab/dabCliRunner";
import { isDabCliEngineResponding, stopDabCliEngine } from "../dab/dabCliProcess";
import { ILogger } from "../sharedInterfaces/logger";
import { LocalContainers } from "../constants/locConstants";
import { Dab } from "../sharedInterfaces/dab";
import { getErrorMessage, uuid } from "../utils/utils";

/**
 * Localhost addresses that need to be transformed for Docker container access
 */
const LOCALHOST_ADDRESSES = ["localhost", "127.0.0.1", "(local)", "."];
const SQL_SERVER_CONNECTION_PROPERTY_PATTERN =
    /((?:Server|Data Source)\s*=\s*)("[^"]*"|'[^']*'|[^;]+)/i;

/**
 * Stands in for the real connection string when hashing a config, so a hash
 * stored with a deployment stays comparable across connections and sessions.
 */
const CONFIG_HASH_CONNECTION_PLACEHOLDER = "<connection-string>";

/**
 * Serializes a parsed config with object keys in a stable order. Array order is
 * preserved because it is meaningful in DAB config (permission actions, REST
 * methods, and fields are already normalized upstream).
 */
function canonicalizeJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalizeJson).join(",")}]`;
    }

    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, entryValue]) => entryValue !== undefined)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalizeJson(entryValue)}`);
        return `{${entries.join(",")}}`;
    }

    return JSON.stringify(value) ?? "null";
}

export class DabService implements Dab.IDabService {
    private _configFileBuilder = new DabConfigFileBuilder();
    private _cliRunner: DabCliRunner | undefined;

    /**
     * @param cliContext Storage path and logger used by the DAB CLI target.
     * Omitted by callers that only use the Docker target.
     */
    constructor(private readonly cliContext?: { storagePath: string; logger: ILogger }) {}

    /**
     * The CLI runner for this session, created on first use so a Docker-only
     * session never touches CLI state.
     */
    private get cliRunner(): DabCliRunner | undefined {
        if (!this.cliContext) {
            return undefined;
        }

        this._cliRunner ??= new DabCliRunner(this.cliContext.storagePath, this.cliContext.logger);
        return this._cliRunner;
    }

    public generateConfig(
        config: Dab.DabConfig,
        connectionInfo: Dab.DabConnectionInfo,
    ): Dab.GenerateConfigResponse {
        try {
            // Transform connection string for Docker container access
            const transformedConnectionInfo = this.transformConnectionInfoForDocker(connectionInfo);
            const configContent = this._configFileBuilder.build(config, transformedConnectionInfo);
            return {
                configContent,
                success: true,
            };
        } catch (error) {
            return {
                configContent: "",
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Runs a specific DAB deployment step.
     * Handles Docker prerequisite steps and DAB-specific steps for image pull,
     * container start, and readiness check.
     *
     * @param step The step to run
     * @param params Optional parameters needed for certain steps
     * @param config Optional DAB config (needed for startContainer step)
     * @param connectionInfo Optional connection info for generating config content
     */
    public async runDeploymentStep(
        step: Dab.DabDeploymentStepOrder,
        params?: Dab.DabDeploymentParams,
        config?: Dab.DabConfig,
        connectionInfo?: Dab.DabConnectionInfo,
    ): Promise<Dab.RunDeploymentStepResponse> {
        // Generate config content if needed for startContainer step
        let configContent: string | undefined;
        if (step === Dab.DabDeploymentStepOrder.startContainer && config && connectionInfo) {
            const configResponse = this.generateConfig(config, connectionInfo);
            if (!configResponse.success) {
                return {
                    success: false,
                    error: configResponse.error,
                };
            }
            configContent = configResponse.configContent;
        }

        return this.executeDeploymentStep(step, params, configContent);
    }

    /**
     * Validates deployment parameters (container name and port).
     *
     * @param containerName The container name to validate
     * @param port The port to validate
     */
    public async validateDeploymentParams(
        containerName: string,
        port: number,
    ): Promise<Dab.ValidateDeploymentParamsResponse> {
        const containerNameValidation = await validateDabContainerName(containerName);
        const isContainerNameValid = containerNameValidation === containerName;

        const availablePort = await findAvailableDabPort(port);
        // A negative result means the scan found nothing free. Suggesting it
        // would put -1 in the port field, so the requested port is echoed back
        // and reported as unusable instead.
        const foundPort = availablePort >= 0;
        const suggestedPort = foundPort ? availablePort : port;
        const isPortValid = foundPort && availablePort === port;

        return {
            isContainerNameValid,
            validatedContainerName: containerNameValidation,
            containerNameError: isContainerNameValid
                ? undefined
                : LocalContainers.dabContainerNameInvalidOrInUse,
            isPortValid,
            suggestedPort,
            portError: isPortValid ? undefined : LocalContainers.dabPortAlreadyInUse(port),
        };
    }

    /**
     * Stops and removes a DAB container.
     *
     * @param containerName Name of the container to stop
     */
    public async stopDeployment(containerName: string): Promise<Dab.StopDeploymentResponse> {
        const result = await stopAndRemoveDabContainer(containerName);
        return {
            success: result.success ?? false,
            error: result.error,
        };
    }

    /**
     * Hashes the DAB config file this configuration would produce.
     *
     * The connection string is replaced with a fixed placeholder and object
     * keys are sorted before hashing, so the hash covers only what DAB will
     * actually serve: reordering entities, or connecting with a different
     * login, does not make a running deployment look outdated.
     *
     * @param config The DAB configuration to hash
     */
    public computeConfigHash(config: Dab.DabConfig): string {
        const configContent = this._configFileBuilder.build(config, {
            connectionString: CONFIG_HASH_CONNECTION_PLACEHOLDER,
        });

        return createHash("sha256")
            .update(canonicalizeJson(JSON.parse(configContent)), "utf8")
            .digest("hex");
    }

    /**
     * Reports the live state of a previously deployed container.
     *
     * @param containerName Name of the container to inspect
     */
    public async getContainerStatus(
        containerName: string,
    ): Promise<Dab.DabDeploymentContainerStatus> {
        return getDabContainerStatus(containerName);
    }

    /**
     * Starts an existing stopped container without redeploying it.
     *
     * @param containerName Name of the container to start
     */
    public async startContainer(containerName: string): Promise<Dab.DeploymentActionResponse> {
        const result = await startDabContainer(containerName);
        return {
            success: result.success ?? false,
            error: result.error,
        };
    }

    /**
     * Stops a running container, leaving it in place so it can be started again.
     *
     * @param containerName Name of the container to stop
     */
    public async stopContainer(containerName: string): Promise<Dab.DeploymentActionResponse> {
        const result = await stopDabContainer(containerName);
        return {
            success: result.success ?? false,
            error: result.error,
        };
    }

    /**
     * Reports whether a host port is still free for a container to publish.
     *
     * @param port The host port to check
     */
    public async isPortAvailable(port: number): Promise<boolean> {
        return isDabPortAvailable(port);
    }

    // #region DAB CLI target

    /**
     * Generates the DAB config for a CLI deployment.
     *
     * Unlike the container config, the connection string is emitted as an
     * `@env` reference: the engine resolves it from its own environment, so the
     * credential is never written to the config file on disk. No Docker host
     * rewriting happens either, because the engine runs on the host and can
     * reach localhost directly.
     *
     * @param config The DAB configuration to generate from
     */
    public generateCliConfig(config: Dab.DabConfig): Dab.GenerateConfigResponse {
        try {
            return {
                configContent: this._configFileBuilder.build(config, {
                    connectionString: `@env('${Dab.DAB_CLI_CONNECTION_STRING_ENV_VAR}')`,
                }),
                success: true,
            };
        } catch (error) {
            return { configContent: "", success: false, error: getErrorMessage(error) };
        }
    }

    /** Path of the config file for a CLI deployment's directory. */
    public getCliConfigPath(deploymentDirectory: string): string {
        return path.join(deploymentDirectory, DAB_CLI_CONFIG_FILE_NAME);
    }

    /**
     * Runs one step of a DAB CLI deployment.
     *
     * @param step The step to run
     * @param params Deployment name and port
     * @param config DAB config, needed from the validate step onward
     * @param connectionInfo Connection whose string is passed to the engine
     * @param configPath Where the generated config lives for this deployment
     */
    public async runCliDeploymentStep(
        step: Dab.DabDeploymentStepOrder,
        params?: Dab.DabDeploymentParams,
        config?: Dab.DabConfig,
        connectionInfo?: Dab.DabConnectionInfo,
        configPath?: string,
    ): Promise<Dab.RunDeploymentStepResponse & { processId?: number }> {
        const runner = this.cliRunner;
        if (!runner) {
            return { success: false, error: LocalContainers.dabDeploymentStoreUnavailable };
        }

        switch (step) {
            case Dab.DabDeploymentStepOrder.acquireDabCli:
                return runner.acquireCli();

            case Dab.DabDeploymentStepOrder.checkDotnetRuntime:
                return runner.resolveRuntime();

            case Dab.DabDeploymentStepOrder.validateCliConfig: {
                if (!params || !config || !connectionInfo || !configPath) {
                    return { success: false, error: LocalContainers.dabCliStartMissingParams };
                }

                const generated = this.generateCliConfig(config);
                if (!generated.success) {
                    return { success: false, error: generated.error };
                }

                return runner.validateConfig(configPath, generated.configContent, {
                    port: params.port,
                    connectionString: connectionInfo.connectionString,
                });
            }

            case Dab.DabDeploymentStepOrder.startCliEngine: {
                if (!params || !connectionInfo || !configPath) {
                    return { success: false, error: LocalContainers.dabCliStartMissingParams };
                }

                return runner.startEngine(configPath, {
                    port: params.port,
                    connectionString: connectionInfo.connectionString,
                });
            }

            case Dab.DabDeploymentStepOrder.checkCliEngine: {
                if (!params) {
                    return { success: false, error: LocalContainers.dabCliStartMissingParams };
                }

                return runner.checkEngine(params.port);
            }

            default:
                return {
                    success: false,
                    error: LocalContainers.dabUnknownDeploymentStep(step),
                };
        }
    }

    /**
     * Resolves the state of a CLI deployment.
     *
     * The port is the source of truth: a stored process id can be reused by an
     * unrelated process, but an answer on the port means the engine is serving.
     * A deployment that is not answering is startable as long as its config
     * file survives, and missing once that file is gone.
     *
     * @param record The tracked deployment to inspect
     */
    public async getCliDeploymentStatus(
        record: Dab.DabDeploymentRecord,
    ): Promise<Dab.DabDeploymentContainerStatus> {
        if (await isDabCliEngineResponding(record.port)) {
            return Dab.DabDeploymentContainerStatus.Running;
        }

        if (!record.configPath) {
            return Dab.DabDeploymentContainerStatus.Missing;
        }

        try {
            await fs.promises.access(record.configPath);
            return Dab.DabDeploymentContainerStatus.Stopped;
        } catch {
            return Dab.DabDeploymentContainerStatus.Missing;
        }
    }

    /**
     * Starts a tracked CLI deployment again from its saved config.
     *
     * The CLI and runtime are re-resolved first because a deployment started in
     * an earlier session leaves nothing resolved in this one.
     *
     * @param record The tracked deployment to start
     * @param connectionInfo Connection whose string is passed to the engine
     */
    public async startCliDeployment(
        record: Dab.DabDeploymentRecord,
        connectionInfo: Dab.DabConnectionInfo,
    ): Promise<Dab.DeploymentActionResponse & { processId?: number }> {
        const runner = this.cliRunner;
        if (!runner) {
            return { success: false, error: LocalContainers.dabDeploymentStoreUnavailable };
        }

        if (!record.configPath) {
            return { success: false, error: LocalContainers.dabCliDeploymentNotStartable };
        }

        const acquireResult = await runner.acquireCli();
        if (!acquireResult.success) {
            return { success: false, error: acquireResult.error };
        }

        const runtimeResult = await runner.resolveRuntime();
        if (!runtimeResult.success) {
            return { success: false, error: runtimeResult.error };
        }

        const startResult = await runner.startEngine(record.configPath, {
            port: record.port,
            connectionString: connectionInfo.connectionString,
        });
        if (!startResult.success) {
            return { success: false, error: startResult.error };
        }

        const readyResult = await runner.checkEngine(record.port);
        return readyResult.success
            ? { success: true, processId: startResult.processId }
            : { success: false, error: readyResult.error };
    }

    /**
     * Stops a running CLI deployment's engine.
     *
     * @param record The tracked deployment to stop
     */
    public async stopCliDeployment(
        record: Dab.DabDeploymentRecord,
    ): Promise<Dab.DeploymentActionResponse> {
        if (!record.processId) {
            // Nothing was launched from this window; the engine is already gone
            // or belongs to a session that has since ended.
            return { success: true };
        }

        const result = await stopDabCliEngine(record.processId);
        return { success: result.success, error: result.error };
    }

    // #endregion

    /**
     * Gets error link information for a specific deployment step.
     * @param step The deployment step
     * @returns Error link and link text, or undefined if no link is available
     */
    private getStepErrorLinkInfo(step: Dab.DabDeploymentStepOrder): {
        errorLink?: string;
        errorLinkText?: string;
    } {
        switch (step) {
            case Dab.DabDeploymentStepOrder.dockerInstallation:
                return {
                    errorLink: dockerInstallErrorLink,
                    errorLinkText: LocalContainers.installDocker,
                };
            case Dab.DabDeploymentStepOrder.checkDockerEngine: {
                const errorLink = getEngineErrorLink();
                const errorLinkText = getEngineErrorLinkText();
                return errorLink ? { errorLink, errorLinkText } : {};
            }
            default:
                return {};
        }
    }

    /**
     * Executes a specific deployment step.
     */
    private async executeDeploymentStep(
        step: Dab.DabDeploymentStepOrder,
        params?: Dab.DabDeploymentParams,
        configContent?: string,
    ): Promise<Dab.RunDeploymentStepResponse> {
        let result: Dab.RunDeploymentStepResponse;

        switch (step) {
            case Dab.DabDeploymentStepOrder.dockerInstallation:
                result = await checkDockerInstallation();
                break;

            case Dab.DabDeploymentStepOrder.startDockerDesktop:
                result = await startDocker();
                break;

            case Dab.DabDeploymentStepOrder.checkDockerEngine:
                result = await checkEngine();
                break;

            case Dab.DabDeploymentStepOrder.pullImage:
                result = await pullDabContainerImage();
                break;

            case Dab.DabDeploymentStepOrder.startContainer: {
                if (!params || !configContent) {
                    result = {
                        success: false,
                        error: LocalContainers.dabStartContainerMissingParams,
                    };
                    break;
                }

                // Write config to temp file
                const configFilePath = await this.writeDabConfigToTempFile(configContent);

                try {
                    const containerResult = await startDabDockerContainer(
                        params.containerName,
                        params.port,
                        configFilePath,
                    );

                    if (containerResult.success) {
                        result = {
                            success: true,
                            apiUrl: `http://localhost:${params.port}`,
                        };
                    } else {
                        result = {
                            ...containerResult,
                            containerLogs: containerResult.fullErrorText,
                        };
                    }
                } catch (e) {
                    result = {
                        success: false,
                        error: LocalContainers.dabFailedToStartContainer,
                        fullErrorText: getErrorMessage(e),
                    };
                } finally {
                    // Config file is copied into container (not bind-mounted), so safe to delete
                    await this.cleanupDabConfigFile(configFilePath);
                }
                break;
            }

            case Dab.DabDeploymentStepOrder.checkContainer: {
                if (!params) {
                    result = {
                        success: false,
                        error: LocalContainers.dabCheckContainerMissingParams,
                    };
                    break;
                }

                const checkResult = await checkIfDabContainerIsReady(
                    params.containerName,
                    params.port,
                );
                if (checkResult.success) {
                    result = {
                        success: true,
                        apiUrl: `http://localhost:${params.port}`,
                    };
                } else {
                    result = checkResult;
                }
                break;
            }

            default:
                result = {
                    success: false,
                    error: LocalContainers.dabUnknownDeploymentStep(step),
                };
        }

        // Add error link info for failed steps
        if (!result.success) {
            const linkInfo = this.getStepErrorLinkInfo(step);
            if (linkInfo.errorLink) {
                result.errorLink = linkInfo.errorLink;
                result.errorLinkText = linkInfo.errorLinkText;
            }
        }

        return result;
    }

    /**
     * Writes the DAB config content to a temporary file.
     * Creates a unique temp directory with the file named 'dab-config.json' inside,
     * so it can be copied into the container with the correct name.
     * @param configContent The DAB configuration JSON content
     * @returns The path to the temporary config file
     */
    private async writeDabConfigToTempFile(configContent: string): Promise<string> {
        // Create a unique temp directory to hold the config file
        const uniqueTempDir = path.join(os.tmpdir(), `dab-${uuid()}`);
        await fs.promises.mkdir(uniqueTempDir, { recursive: true });

        // Name the file dab-config.json so it can be copied into the container as-is
        const configFilePath = path.join(uniqueTempDir, "dab-config.json");

        // Use restrictive permissions (owner read/write only) since the file contains
        // sensitive connection string data. This is safe because we copy the file into
        // the container rather than bind-mounting it.
        await fs.promises.writeFile(configFilePath, configContent, {
            encoding: "utf8",
            mode: 0o600,
        });
        dockerLogger.debug(`DAB config written to: ${configFilePath}`);

        return configFilePath;
    }

    /**
     * Cleans up a temporary DAB config file and its parent directory
     * @param configFilePath Path to the config file to delete
     */
    private async cleanupDabConfigFile(configFilePath: string): Promise<void> {
        try {
            const configDir = path.dirname(configFilePath);

            // Remove the config file (ignore if already deleted)
            await fs.promises.unlink(configFilePath).catch(() => {});

            // Remove the temp directory if it's in the temp folder and starts with 'dab-'
            if (configDir.startsWith(os.tmpdir()) && path.basename(configDir).startsWith("dab-")) {
                await fs.promises.rmdir(configDir);
            }

            dockerLogger.debug(`Cleaned up DAB config: ${configFilePath}`);
        } catch (e) {
            dockerLogger.warn(`Failed to cleanup DAB config file: ${getErrorMessage(e)}`);
        }
    }

    /**
     * Transforms the connection info for use inside a Docker container.
     * Replaces localhost references with either:
     * - The SQL Server container name (if SQL Server is running in a container)
     * - host.docker.internal (if SQL Server is running on the host machine)
     */
    private transformConnectionInfoForDocker(
        connectionInfo: Dab.DabConnectionInfo,
    ): Dab.DabConnectionInfo {
        const { connectionString, sqlServerContainerName } = connectionInfo;

        // Parse the server/data source from the connection string.
        // Supports both "Server=" and "Data Source=" formats, including quoted values.
        const serverMatch = connectionString.match(SQL_SERVER_CONNECTION_PROPERTY_PATTERN);
        if (!serverMatch) {
            return connectionInfo;
        }

        const serverPropertyPrefix = serverMatch[1];
        const serverValue = this.stripConnectionStringValueQuotes(serverMatch[2].trim());
        const protocolPrefix = serverValue.match(/^tcp:\s*/i)?.[0] ?? "";
        const serverAddress = serverValue.substring(protocolPrefix.length);

        // Parse the server address to check if it's localhost
        const host = this.parseHostFromServerValue(serverAddress);

        // Check if this is a localhost address
        if (!this.isLocalhostAddress(host)) {
            return connectionInfo;
        }

        const hasPort = serverAddress.includes(",");
        let newServerValue = serverAddress.replace(
            new RegExp(`^${this.escapeRegex(host)}`, "i"),
            "host.docker.internal",
        );
        newServerValue = this.normalizeSqlServerPortSpacing(newServerValue);

        if (sqlServerContainerName) {
            // SQL Server containers created by the extension expose SQL Server through
            // a host port. DAB runs in a separate container, so it must connect to that
            // published port through host.docker.internal instead of treating the
            // container name as a SQL Server named instance.
            const commaIndex = serverAddress.indexOf(",");
            const port = commaIndex !== -1 ? this.normalizeSqlServerPort(serverAddress) : "";
            newServerValue = `host.docker.internal${port}`;
        }

        // DAB does not infer the default SQL Server port, so explicitly add it
        // when the connection string omits the port for a localhost address.
        if (!hasPort) {
            newServerValue += `,${DefaultSqlPortNumber}`;
        }
        newServerValue = `${protocolPrefix}${newServerValue}`;

        // Replace in connection string
        const transformedConnectionString = connectionString.replace(
            SQL_SERVER_CONNECTION_PROPERTY_PATTERN,
            `${serverPropertyPrefix}${newServerValue}`,
        );

        dockerLogger.info(
            `Transformed connection string server for DAB: ${serverValue} -> ${newServerValue}`,
        );

        return {
            ...connectionInfo,
            connectionString: transformedConnectionString,
        };
    }

    /**
     * Parses the host portion from a SQL Server value.
     * Handles formats like: "localhost", "localhost,1433", "localhost\\instance"
     */
    private parseHostFromServerValue(serverValue: string): string {
        let host = serverValue;

        // Remove port specification (comma-separated)
        const commaIndex = serverValue.indexOf(",");
        if (commaIndex !== -1) {
            host = serverValue.substring(0, commaIndex).trim();
        }

        // Remove instance name (backslash-separated)
        const backslashIndex = host.indexOf("\\");
        if (backslashIndex !== -1) {
            host = host.substring(0, backslashIndex);
        }

        return host;
    }

    private stripConnectionStringValueQuotes(value: string): string {
        const trimmedValue = value.trim();
        if (
            trimmedValue.length >= 2 &&
            ((trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
                (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")))
        ) {
            return trimmedValue.substring(1, trimmedValue.length - 1).trim();
        }

        return trimmedValue;
    }

    private normalizeSqlServerPort(serverValue: string): string {
        const commaIndex = serverValue.indexOf(",");
        if (commaIndex === -1) {
            return "";
        }

        const port = serverValue.substring(commaIndex + 1).trim();
        return port ? `,${port}` : "";
    }

    private normalizeSqlServerPortSpacing(serverValue: string): string {
        const commaIndex = serverValue.indexOf(",");
        if (commaIndex === -1) {
            return serverValue;
        }

        return `${serverValue.substring(0, commaIndex)},${serverValue.substring(commaIndex + 1).trim()}`;
    }

    /**
     * Checks if the given host is a localhost address
     */
    private isLocalhostAddress(host: string): boolean {
        return LOCALHOST_ADDRESSES.some((addr) => host.toLowerCase() === addr.toLowerCase());
    }

    /**
     * Escapes special regex characters in a string
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
}
