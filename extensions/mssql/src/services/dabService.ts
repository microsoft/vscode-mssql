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

export class DabService implements Dab.IDabService {
    private _configFileBuilder = new DabConfigFileBuilder();

    public generateConfig(
        config: Dab.DabConfig,
        connectionInfo: Dab.DabConnectionInfo,
    ): Dab.GenerateConfigResponse {
        try {
            const configContent = this._configFileBuilder.build(config, connectionInfo);
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
     * @param connectionString Connection string for generating config content
     */
    public async runDeploymentStep(
        step: Dab.DabDeploymentStepOrder,
        params?: Dab.DabDeploymentParams,
        config?: Dab.DabConfig,
        connectionString?: string,
    ): Promise<Dab.RunDeploymentStepResponse> {
        // Generate config content if needed for startContainer step
        let configContent: string | undefined;
        if (step === Dab.DabDeploymentStepOrder.startContainer && config && connectionString) {
            const configResponse = this.generateConfig(config, { connectionString });
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
                const configFilePath = this.writeDabConfigToTempFile(configContent);

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
                    // Clean up temp config file - the container has already loaded/mounted the config
                    this.cleanupDabConfigFile(configFilePath);
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
     * Writes the DAB config content to a temporary file
     * @param configContent The DAB configuration JSON content
     * @returns The path to the temporary config file
     */
    private writeDabConfigToTempFile(configContent: string): string {
        const tempDir = os.tmpdir();
        const configFileName = `dab-config-${crypto.randomUUID()}.json`;
        const configFilePath = path.join(tempDir, configFileName);

        // Note: We use default permissions (typically 0644) rather than restrictive permissions (0600)
        // because this file is mounted into the Docker container. The container process runs as a
        // different user and needs read access to the config file.
        fs.writeFileSync(configFilePath, configContent, "utf8");
        dockerLogger.appendLine(`DAB config written to: ${configFilePath}`);

        return configFilePath;
    }

    /**
     * Cleans up a temporary DAB config file
     * @param configFilePath Path to the config file to delete
     */
    private cleanupDabConfigFile(configFilePath: string): void {
        try {
            if (fs.existsSync(configFilePath)) {
                fs.unlinkSync(configFilePath);
                dockerLogger.appendLine(`Cleaned up DAB config file: ${configFilePath}`);
            }
        } catch (e) {
            dockerLogger.appendLine(`Failed to cleanup DAB config file: ${getErrorMessage(e)}`);
        }
    }
}
