/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from "vscode-mssql";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import {
    FormContextProps,
    FormEvent,
    FormItemSpec,
    FormState,
} from "../../common/forms/form";

export class ContainerDeploymentWebviewState
    implements FormState<DockerConnectionProfile>
{
    loadState: ApiStatus = ApiStatus.Loading;
    errorMessage?: string;
    public dockerInstallStatus: DockerStep = {
        loadState: ApiStatus.Loading,
    };
    public dockerStatus: DockerStep = {
        loadState: ApiStatus.Loading,
    };
    public dockerEngineStatus: DockerStep = {
        loadState: ApiStatus.Loading,
    };
    formState: DockerConnectionProfile = undefined;
    formComponents: Record<
        string,
        FormItemSpec<ContainerDeploymentWebviewState, DockerConnectionProfile>
    > = {};
    platform: string = "";
    // Used for container name validation within the form
    isValidContainerName: boolean = false;

    constructor(params?: Partial<ContainerDeploymentWebviewState>) {
        for (const key in params) {
            if (key in this) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- safe due to key in this check being a Partial of the class
                (this as any)[key as keyof ContainerDeploymentWebviewState] =
                    params[key as keyof ContainerDeploymentWebviewState]!;
            }
        }
    }
}

export interface DockerConnectionProfile extends vscodeMssql.IConnectionInfo {
    containerLoadState: ApiStatus.Loading;
    version: string;
    acceptEula: boolean;
}

export interface DockerStep {
    loadState: ApiStatus;
    errorMessage?: string;
}

export interface ContainerDeploymentContextProps
    extends FormContextProps<
        ContainerDeploymentWebviewState,
        DockerConnectionProfile
    > {
    /**
     * Gets the execution plan graph from the provider
     */
    checkDockerInstallation(): void;
    /**
     * Gets the execution plan graph from the provider
     */
    startDocker(): void;
    /**
     * Gets the execution plan graph from the provider
     */
    checkLinuxEngine(): void;
    /**
     * Gets the execution plan graph from the provider
     */
    validateContainerName(name: string): void;
}

export interface ContainerDeploymentReducers {
    /**
     * Gets the execution plan graph from the provider
     */
    checkDockerInstallation: {};

    /**
     * Gets the execution plan graph from the provider
     */
    startDocker: {};

    /**
     * Gets the execution plan graph from the provider
     */
    checkLinuxEngine: {};

    setFormComponents: {
        components: FormItemSpec<
            ContainerDeploymentWebviewState,
            DockerConnectionProfile
        >[];
    };

    /**
     * Gets the execution plan graph from the provider
     */
    validateContainerName: { name: string };

    formAction: {
        event: FormEvent<DockerConnectionProfile>;
    };
}

export const COMMANDS = {
    CHECK_DOCKER: "docker --version",
    START_DOCKER: {
        win32: 'start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"',
        // still need to test
        darwin: "open -a Docker",
        // still need to test
        linux: "systemctl start docker",
    },
    SWITCH_LINUX_ENGINE: `powershell -Command "& \\"C:\\Program Files\\Docker\\Docker\\DockerCli.exe\\" -SwitchLinuxEngine"`,
    GET_CONTAINERS: `docker ps -a --format "{{.ID}}"`,
    INSPECT: (id: string) => `docker inspect ${id}`,
    FIND_PORTS: {
        win32: `powershell -Command "docker ps -a --format '{{.ID}}' | ForEach-Object { docker inspect $_ | Select-String -Pattern '\"HostPort\":' | Select-Object -First 1 | ForEach-Object { ($_ -split ':')[1].Trim() -replace '\"', '' }}"`,
        // still need to test
        darwin: `docker ps -a --format "{{.ID}}" | xargs -I {} sh -c 'docker inspect {} | grep -m 1 -oP "\"HostPort\": \"\K\d+"'`,
        // still need to test
        linux: `docker ps -a --format "{{.ID}}" | xargs -I {} sh -c 'docker inspect {} | grep -m 1 -oP "\"HostPort\": \"\K\d+"'`,
    },
    START_SQL_SERVER: (
        name: string,
        password: string,
        port: number,
        version: number,
    ) =>
        `docker run -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=${password}" -p ${port}:1433 --name ${name} -d mcr.microsoft.com/mssql/server:${version}-latest`,
    CHECK_CONTAINER_RUNNING: (name: string) =>
        `docker ps --filter "name=${name}" --filter "status=running" --format "{{.Names}}"`,
    VALIDATE_CONTAINER_NAME: 'docker ps --format "{{.Names}}"',
    START_CONTAINER: (name: string) => `docker start ${name}`,
    CHECK_LOGS: (name: string, platform: string) =>
        `docker logs --tail 15 ${name} | ${platform === "win32" ? 'findstr "Recovery is complete"' : 'grep "Recovery is complete"'}`,
    CHECK_CONTAINER_READY: `Recovery is complete`,
};

export type DockerCommandParams = {
    success: boolean;
    error?: string;
    port?: number;
};
