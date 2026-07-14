/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AnimationFrameScheduler {
    request(callback: FrameRequestCallback): number;
    cancel(handle: number): void;
}

const browserAnimationFrameScheduler: AnimationFrameScheduler = {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * Leading/trailing frame-clock throttle. The first value is delivered on the
 * next paint; while updates continue, only the latest value is retained and
 * delivery is capped by {@link minimumIntervalMs}. Unlike timer throttles,
 * this cannot be stretched to one second by Chromium's background timer clamp.
 */
export class FrameThrottledEmitter<T> {
    private frameHandle: number | undefined;
    private hasPendingValue = false;
    private pendingValue: T | undefined;
    private lastEmissionTimestamp: number | undefined;

    public constructor(
        private readonly emit: (value: T) => void,
        private readonly minimumIntervalMs: number,
        private readonly scheduler: AnimationFrameScheduler = browserAnimationFrameScheduler,
    ) {}

    public update(value: T): void {
        this.pendingValue = value;
        this.hasPendingValue = true;
        this.scheduleFrame();
    }

    /** Cancel pending work and reset the throttle so it can be reused after effect replay. */
    public clear(): void {
        if (this.frameHandle !== undefined) {
            this.scheduler.cancel(this.frameHandle);
        }
        this.frameHandle = undefined;
        this.hasPendingValue = false;
        this.pendingValue = undefined;
        this.lastEmissionTimestamp = undefined;
    }

    private readonly onFrame = (timestamp: number): void => {
        this.frameHandle = undefined;
        if (!this.hasPendingValue) {
            return;
        }
        if (
            this.lastEmissionTimestamp !== undefined &&
            timestamp - this.lastEmissionTimestamp < this.minimumIntervalMs
        ) {
            this.scheduleFrame();
            return;
        }

        const value = this.pendingValue as T;
        this.hasPendingValue = false;
        this.pendingValue = undefined;
        this.lastEmissionTimestamp = timestamp;
        this.emit(value);
    };

    private scheduleFrame(): void {
        if (this.frameHandle === undefined) {
            this.frameHandle = this.scheduler.request(this.onFrame);
        }
    }
}
