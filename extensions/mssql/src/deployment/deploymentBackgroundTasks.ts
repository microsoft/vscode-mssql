/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    BackgroundTaskHandle,
    BackgroundTaskState,
} from "../backgroundTasks/backgroundTasksService";
import { DeploymentType } from "../sharedInterfaces/deployment";
import { DeploymentWebviewController } from "./deploymentWebviewController";

const activeProvisioningTasks = new WeakMap<
    DeploymentWebviewController,
    Map<DeploymentType, BackgroundTaskHandle>
>();

export function startProvisioningTask(
    controller: DeploymentWebviewController,
    deploymentType: DeploymentType,
    displayText: string,
    target: string,
): BackgroundTaskHandle {
    let controllerTasks = activeProvisioningTasks.get(controller);
    if (!controllerTasks) {
        controllerTasks = new Map();
        activeProvisioningTasks.set(controller, controllerTasks);
    }

    const activeTask = controllerTasks.get(deploymentType);
    if (activeTask) {
        return activeTask;
    }

    const task = controller.mainController.backgroundTasksService.registerTask({
        displayText,
        target,
        tooltip: displayText,
        message: displayText,
        state: BackgroundTaskState.InProgress,
    });
    controllerTasks.set(deploymentType, task);
    return task;
}

export function updateProvisioningTask(
    controller: DeploymentWebviewController,
    deploymentType: DeploymentType,
    message: string,
): void {
    activeProvisioningTasks.get(controller)?.get(deploymentType)?.update({ message });
}

export function completeProvisioningTask(
    controller: DeploymentWebviewController,
    deploymentType: DeploymentType,
    state: BackgroundTaskState,
    message: string,
): void {
    const controllerTasks = activeProvisioningTasks.get(controller);
    const task = controllerTasks?.get(deploymentType);
    if (!task) return;

    task.complete(state, { message });
    controllerTasks?.delete(deploymentType);
    if (controllerTasks?.size === 0) activeProvisioningTasks.delete(controller);
}
