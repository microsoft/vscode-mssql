/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DabConfigFileBuilder } from "../dab/dabConfigFileBuilder";
import {
    checkDockerInstallation,
    checkEngine,
    checkIfDabContainerIsReady,
    dockerInstallErrorLink,
    dockerLogger,
    findAvailableDabPort,
    getEngineErrorLink,
    getEngineErrorLinkText,
    pullDabContainerImage,
    startDabDockerContainer,
    startDocker,
    stopAndRemoveDabContainer,
    validateDabContainerName,
} from "../deployment/dockerUtils";
import { LocalContainers } from "../constants/locConstants";
import { Dab } from "../sharedInterfaces/dab";
import { getErrorMessage } from "../utils/utils";

/**
 * Localhost addresses that need to be transformed for Docker container access
 */
const LOCALHOST_ADDRESSES = ["localhost", "127.0.0.1", "(local)", "."];

export class DabService implements Dab.IDabService {
    private _configFileBuilder = new DabConfigFileBuilder();

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

        const suggestedPort = await findAvailableDabPort(port);
        const isPortValid = suggestedPort === port;

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
                        result = containerResult;
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
        const uniqueTempDir = path.join(os.tmpdir(), `dab-${crypto.randomUUID()}`);
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
        dockerLogger.appendLine(`DAB config written to: ${configFilePath}`);

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

            dockerLogger.appendLine(`Cleaned up DAB config: ${configFilePath}`);
        } catch (e) {
            dockerLogger.appendLine(`Failed to cleanup DAB config file: ${getErrorMessage(e)}`);
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

        // Parse the server/data source from the connection string
        // Supports both "Server=" and "Data Source=" formats
        const serverMatch = connectionString.match(/(?:Server|Data Source)\s*=\s*([^;]+)/i);
        if (!serverMatch) {
            return connectionInfo;
        }

        const serverValue = serverMatch[1].trim();

        // Parse the server address to check if it's localhost
        const host = this.parseHostFromServerValue(serverValue);

        // Check if this is a localhost address
        if (!this.isLocalhostAddress(host)) {
            return connectionInfo;
        }

        // Always use host.docker.internal to reach services on the host machine.
        // For containerized SQL Server, append the container name as a suffix
        // since port mapping exposes it on the host.
        const newHost = sqlServerContainerName
            ? `host.docker.internal\\${sqlServerContainerName}`
            : "host.docker.internal";

        // Replace the host portion in the server value, preserving port and instance name
        const newServerValue = serverValue.replace(
            new RegExp(`^${this.escapeRegex(host)}`, "i"),
            newHost,
        );

        // Replace in connection string
        const transformedConnectionString = connectionString.replace(
            /(?:Server|Data Source)\s*=\s*[^;]+/i,
            `Server=${newServerValue}`,
        );

        dockerLogger.appendLine(
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
