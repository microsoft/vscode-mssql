/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runs a DAB deployment from its first step to its last.
 *
 * The run belongs to the extension, not to the designer that started it, so
 * closing the designer does not stop it. One run is kept per database; a
 * designer opened on that database again picks it up where it is.
 *
 * Steps run one after another. A step that needs the user, such as a sign-in,
 * leaves the run waiting until the user answers through {@link respond}.
 */

import * as vscode from "vscode";
import { Dab } from "../sharedInterfaces/dab";
import { ApiStatus } from "../sharedInterfaces/webview";
import { getErrorMessage, uuid } from "../utils/utils";

/** What a run needs from the designer that started it. */
export interface DabDeploymentRunHost {
    /** Picks the name and port, removing an existing deployment being replaced. */
    prepare(): Promise<Dab.PrepareDeploymentResponse>;
    /** Runs one step, with the user's answer when the step was waiting for one. */
    runStep(
        step: Dab.DabDeploymentStepOrder,
        params: Dab.DabDeploymentParams | undefined,
        action: Dab.DabDeploymentStepAction | undefined,
        onProgress: (progress: Dab.DabDeploymentStepProgress) => void,
    ): Promise<Dab.RunDeploymentStepResponse>;
    /** Removes what a failed or canceled attempt left behind. */
    cleanUp(params: Dab.DabDeploymentParams): Promise<void>;
    /** Stops a sign-in that is waiting in a browser. */
    cancelSignIn(): void;
}

export interface DabDeploymentRunOptions {
    target: Dab.DabDeploymentTarget;
    stepOptions: Dab.DabDeploymentStepOptions;
    /** Deployment being replaced, when one exists. */
    deploymentId?: string;
}

/** Shortest gap between two progress reports, so a download does not flood listeners. */
const PROGRESS_INTERVAL_MS = 250;

export class DabDeploymentRun implements vscode.Disposable {
    private _state: Dab.DabDeploymentRunState;
    private readonly _onDidChange = new vscode.EventEmitter<Dab.DabDeploymentRunState>();
    public readonly onDidChange = this._onDidChange.event;

    /** Bumped by retry and cancel, so a loop from an earlier attempt stops. */
    private _generation = 0;
    private _answer: ((action: Dab.DabDeploymentStepAction | undefined) => void) | undefined;
    /** An answer given while a step was still running, such as switching to a code sign-in. */
    private _interruption: Dab.DabDeploymentStepAction | undefined;
    private _lastProgressAt = 0;

    constructor(
        private readonly host: DabDeploymentRunHost,
        options: DabDeploymentRunOptions,
    ) {
        this._state = {
            runId: uuid(),
            target: options.target,
            mode: options.deploymentId
                ? Dab.DabDeploymentMode.Redeploy
                : Dab.DabDeploymentMode.Create,
            status: Dab.DabDeploymentRunStatus.Running,
            stepStatuses: Dab.getDabDeploymentSteps(options.target, options.stepOptions).map(
                (step) => ({ step, status: ApiStatus.NotStarted }),
            ),
        };
    }

    public get state(): Dab.DabDeploymentRunState {
        return this._state;
    }

    public get isActive(): boolean {
        return (
            this._state.status === Dab.DabDeploymentRunStatus.Running ||
            this._state.status === Dab.DabDeploymentRunStatus.Waiting
        );
    }

    public start(): void {
        void this.runFrom(0, this._generation);
    }

    /**
     * Answers a step. A step waiting for the user resumes with the answer. A
     * sign-in still running in a browser is stopped and replaced, which is how
     * a user who never saw the browser open switches to a code.
     */
    public respond(step: Dab.DabDeploymentStepOrder, action: Dab.DabDeploymentStepAction): void {
        const stepStatus = this.getStepStatus(step);
        if (!this.isActive || stepStatus?.status !== ApiStatus.Loading) {
            return;
        }

        if (this._answer) {
            const answer = this._answer;
            this._answer = undefined;
            answer(action);
            return;
        }

        this._interruption = action;
        this.host.cancelSignIn();
    }

    /**
     * Runs a failed deployment again. A failed prerequisite reruns them all,
     * since a later check can depend on an earlier one; a failed deployment
     * step reruns the deployment steps after removing what it left behind.
     */
    public async retry(): Promise<void> {
        if (this._state.status !== Dab.DabDeploymentRunStatus.Failed) {
            return;
        }

        const generation = ++this._generation;
        const failedIndex = this._state.stepStatuses.findIndex(
            (stepStatus) => stepStatus.status === ApiStatus.Error,
        );
        const failedStep = this._state.stepStatuses[failedIndex]?.step;
        const restartIndex =
            failedStep === undefined || Dab.isDabPrerequisiteStep(this._state.target, failedStep)
                ? 0
                : this._state.stepStatuses.findIndex(
                      (stepStatus) =>
                          !Dab.isDabPrerequisiteStep(this._state.target, stepStatus.step),
                  );

        if (restartIndex > 0 && this._state.params) {
            await this.host.cleanUp(this._state.params);
        }

        this.update({
            status: Dab.DabDeploymentRunStatus.Running,
            stepStatuses: this._state.stepStatuses.map((stepStatus, index) =>
                index >= restartIndex
                    ? { step: stepStatus.step, status: ApiStatus.NotStarted }
                    : stepStatus,
            ),
        });
        void this.runFrom(restartIndex, generation);
    }

    /** Stops the run and removes what it left half done. */
    public async cancel(): Promise<void> {
        if (!this.isActive && this._state.status !== Dab.DabDeploymentRunStatus.Failed) {
            return;
        }

        this._generation++;
        const answer = this._answer;
        this._answer = undefined;
        answer?.(undefined);
        this.host.cancelSignIn();
        this.update({ status: Dab.DabDeploymentRunStatus.Canceled });

        if (this._state.params) {
            try {
                await this.host.cleanUp(this._state.params);
            } catch {
                // Cleanup is best effort; the deployment view shows what remains.
            }
        }
    }

    public dispose(): void {
        this._onDidChange.dispose();
    }

    private async runFrom(startIndex: number, generation: number): Promise<void> {
        const isStale = () => generation !== this._generation;
        const firstDeploymentStep =
            Dab.dabDeploymentStepsByTarget[this._state.target].deployment[0];

        for (let index = startIndex; index < this._state.stepStatuses.length; index++) {
            const step = this._state.stepStatuses[index].step;
            this.updateStep(step, { status: ApiStatus.Loading });

            try {
                // The name and port are picked once the prerequisites pass,
                // because a Docker deployment can only see which ports
                // containers hold once Docker is running.
                if (step === firstDeploymentStep && !this._state.params) {
                    const prepared = await this.host.prepare();
                    if (isStale()) {
                        return;
                    }
                    if (!prepared.success || !prepared.params) {
                        this.fail(step, { message: prepared.error });
                        return;
                    }
                    this.update({ params: prepared.params });
                }

                const response = await this.runStepUntilAnswered(step, isStale);
                if (!response || isStale()) {
                    return;
                }

                if (!response.success) {
                    this.fail(step, {
                        message: response.error,
                        containerLogs: response.containerLogs,
                        fullErrorText: response.fullErrorText,
                        errorLink: response.errorLink,
                        errorLinkText: response.errorLinkText,
                    });
                    return;
                }

                this.updateStep(step, { status: ApiStatus.Loaded, detail: response.detail });
            } catch (error) {
                if (!isStale()) {
                    this.fail(step, { message: getErrorMessage(error) });
                }
                return;
            }
        }

        this.update({ status: Dab.DabDeploymentRunStatus.Succeeded });
    }

    /**
     * Runs a step, following it through any prompts until it has an outcome.
     * Returns undefined when the run was canceled or retried meanwhile.
     */
    private async runStepUntilAnswered(
        step: Dab.DabDeploymentStepOrder,
        isStale: () => boolean,
    ): Promise<Dab.RunDeploymentStepResponse | undefined> {
        let response = await this.runStep(step, undefined);

        while (!isStale()) {
            const interruption = this._interruption;
            this._interruption = undefined;
            if (interruption) {
                this.updateStep(step, { status: ApiStatus.Loading, action: interruption });
                response = await this.runStep(step, interruption);
                continue;
            }

            // A device code sign-in reports its code first. The code stays on
            // screen while the second request waits for the user to enter it.
            if (response.prompt?.kind === "entraDeviceCode") {
                this.updateStep(step, {
                    status: ApiStatus.Loading,
                    prompt: response.prompt,
                    action: Dab.DabDeploymentStepAction.AwaitSignIn,
                });
                response = await this.runStep(step, Dab.DabDeploymentStepAction.AwaitSignIn);
                continue;
            }

            if (response.prompt) {
                this.updateStep(step, { status: ApiStatus.Loading, prompt: response.prompt });
                this.update({ status: Dab.DabDeploymentRunStatus.Waiting });
                const action = await new Promise<Dab.DabDeploymentStepAction | undefined>(
                    (resolve) => (this._answer = resolve),
                );
                if (!action || isStale()) {
                    return undefined;
                }

                this.update({ status: Dab.DabDeploymentRunStatus.Running });
                this.updateStep(step, { status: ApiStatus.Loading, action });
                response = await this.runStep(step, action);
                continue;
            }

            return response;
        }

        return undefined;
    }

    private runStep(
        step: Dab.DabDeploymentStepOrder,
        action: Dab.DabDeploymentStepAction | undefined,
    ): Promise<Dab.RunDeploymentStepResponse> {
        return this.host.runStep(step, this._state.params, action, (progress) => {
            const now = Date.now();
            if (now - this._lastProgressAt < PROGRESS_INTERVAL_MS) {
                return;
            }
            this._lastProgressAt = now;

            const stepStatus = this.getStepStatus(step);
            if (stepStatus?.status === ApiStatus.Loading) {
                this.updateStep(step, { ...stepStatus, progress });
            }
        });
    }

    private fail(
        step: Dab.DabDeploymentStepOrder,
        update: Partial<Omit<Dab.DabDeploymentStepStatus, "step" | "status">>,
    ): void {
        this.updateStep(step, { status: ApiStatus.Error, ...update });
        this.update({ status: Dab.DabDeploymentRunStatus.Failed });
    }

    private getStepStatus(step: Dab.DabDeploymentStepOrder) {
        return this._state.stepStatuses.find((stepStatus) => stepStatus.step === step);
    }

    /** Replaces a step's status. Fields not given are cleared, so a stale prompt never lingers. */
    private updateStep(
        step: Dab.DabDeploymentStepOrder,
        update: Omit<Dab.DabDeploymentStepStatus, "step">,
    ): void {
        this.update({
            stepStatuses: this._state.stepStatuses.map((stepStatus) =>
                stepStatus.step === step ? { ...update, step } : stepStatus,
            ),
        });
    }

    private update(update: Partial<Dab.DabDeploymentRunState>): void {
        this._state = { ...this._state, ...update };
        this._onDidChange.fire(this._state);
    }
}

/** The run for each database, keyed by the deployment store key. */
const runs = new Map<string, DabDeploymentRun>();

export function getDabDeploymentRun(key: string): DabDeploymentRun | undefined {
    return runs.get(key);
}

export function setDabDeploymentRun(key: string, run: DabDeploymentRun): void {
    runs.get(key)?.dispose();
    runs.set(key, run);
}

/** Forgets a finished run. An active one is left alone. */
export function dismissDabDeploymentRun(key: string, runId: string): void {
    const run = runs.get(key);
    if (run && run.state.runId === runId && !run.isActive) {
        runs.delete(key);
        run.dispose();
    }
}
