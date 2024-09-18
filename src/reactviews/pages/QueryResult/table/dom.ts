/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IDimension {
    readonly width: number;
    readonly height: number;
}

export function addDisposableListener(
    node: EventTarget,
    type: string,
    handler: (event: any) => void,
    useCaptureOrOptions?: boolean | AddEventListenerOptions,
): DomListener {
    return new DomListener(node, type, handler, useCaptureOrOptions);
}

class DomListener {
    private _handler: (e: any) => void;
    private _node: EventTarget;
    private readonly _type: string;
    private readonly _options: boolean | AddEventListenerOptions;

    constructor(
        node: EventTarget,
        type: string,
        handler: (e: any) => void,
        options?: boolean | AddEventListenerOptions,
    ) {
        this._node = node;
        this._type = type;
        this._handler = handler;
        this._options = options || false;
        this._node.addEventListener(this._type, this._handler, this._options);
    }

    public dispose(): void {
        if (!this._handler) {
            // Already disposed
            return;
        }

        this._node.removeEventListener(
            this._type,
            this._handler,
            this._options,
        );

        // Prevent leakers from holding on to the dom or handler func
        this._node = null!;
        this._handler = null!;
    }
}
export class Dimension implements IDimension {
    static readonly None = new Dimension(0, 0);

    constructor(
        public readonly width: number,
        public readonly height: number,
    ) {}

    with(width: number = this.width, height: number = this.height): Dimension {
        if (width !== this.width || height !== this.height) {
            return new Dimension(width, height);
        } else {
            return this;
        }
    }

    static is(obj: unknown): obj is IDimension {
        return (
            typeof obj === "object" &&
            typeof (<IDimension>obj).height === "number" &&
            typeof (<IDimension>obj).width === "number"
        );
    }

    static lift(obj: IDimension): Dimension {
        if (obj instanceof Dimension) {
            return obj;
        } else {
            return new Dimension(obj.width, obj.height);
        }
    }

    static equals(a: Dimension | undefined, b: Dimension | undefined): boolean {
        if (a === b) {
            return true;
        }
        if (!a || !b) {
            return false;
        }
        return a.width === b.width && a.height === b.height;
    }
}

export function createStyleSheet(
    container: HTMLElement = document.getElementsByTagName("head")[0],
    beforeAppend?: (style: HTMLStyleElement) => void,
): HTMLStyleElement {
    const style = document.createElement("style");
    style.type = "text/css";
    style.media = "screen";
    beforeAppend?.(style);
    container.appendChild(style);
    return style;
}
