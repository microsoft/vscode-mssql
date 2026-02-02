/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Docker client
export {
    getDockerClient,
    resetDockerClient,
    checkDockerInstallation,
    pingDocker,
    getDockerInfo,
} from "./dockerClient";

// Docker container operations
export {
    sanitizeContainerName,
    listContainers,
    getContainerNames,
    isContainerRunning,
    containerExists,
    startContainer,
    stopContainer,
    removeContainer,
    getContainerLogs,
    getContainerNameById,
    getUsedPorts,
    findAvailablePort,
    pullImage,
    createAndStartContainer,
    generateUniqueContainerName,
    validateContainerName,
    type PullImageProgress,
} from "./dockerOperations";

// OS-specific commands for Docker Desktop
export {
    OS_COMMANDS,
    execCommand,
    execCommandWithPipe,
    getDockerExecutablePath,
    getStartDockerCommand,
    type ShellCommand,
} from "./osCommands";
