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

    this._node.removeEventListener(this._type, this._handler, this._options);

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

const SELECTOR_REGEX = /([\w\-]+)?(#([\w\-]+))?((\.([\w\-]+))*)/;

export enum Namespace {
  HTML = "http://www.w3.org/1999/xhtml",
  SVG = "http://www.w3.org/2000/svg",
}

function _$<T extends Element>(
  namespace: Namespace,
  description: string,
  attrs?: { [key: string]: any },
  ...children: Array<Node | string>
): T {
  const match = SELECTOR_REGEX.exec(description);

  if (!match) {
    throw new Error("Bad use of emmet");
  }

  const tagName = match[1] || "div";
  let result: T;

  if (namespace !== Namespace.HTML) {
    result = document.createElementNS(namespace as string, tagName) as T;
  } else {
    result = document.createElement(tagName) as unknown as T;
  }

  if (match[3]) {
    result.id = match[3];
  }
  if (match[4]) {
    result.className = match[4].replace(/\./g, " ").trim();
  }

  if (attrs) {
    Object.entries(attrs).forEach(([name, value]) => {
      if (typeof value === "undefined") {
        return;
      }

      if (/^on\w+$/.test(name)) {
        (<any>result)[name] = value;
      } else if (name === "selected") {
        if (value) {
          result.setAttribute(name, "true");
        }
      } else {
        result.setAttribute(name, value);
      }
    });
  }

  result.append(...children);

  return result as T;
}

export function $<T extends HTMLElement>(
  description: string,
  attrs?: { [key: string]: any },
  ...children: Array<Node | string>
): T {
  return _$(Namespace.HTML, description, attrs, ...children);
}

export function append<T extends Node>(parent: HTMLElement, child: T): T;
export function append<T extends Node>(
  parent: HTMLElement,
  ...children: (T | string)[]
): void;
export function append<T extends Node>(
  parent: HTMLElement,
  ...children: (T | string)[]
): T | void {
  parent.append(...children);
  if (children.length === 1 && typeof children[0] !== "string") {
    return <T>children[0];
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

export const EventType = {
  // Mouse
  CLICK: "click",
  AUXCLICK: "auxclick",
  DBLCLICK: "dblclick",
  MOUSE_UP: "mouseup",
  MOUSE_DOWN: "mousedown",
  MOUSE_OVER: "mouseover",
  MOUSE_MOVE: "mousemove",
  MOUSE_OUT: "mouseout",
  MOUSE_ENTER: "mouseenter",
  MOUSE_LEAVE: "mouseleave",
  MOUSE_WHEEL: "wheel",
  POINTER_UP: "pointerup",
  POINTER_DOWN: "pointerdown",
  POINTER_MOVE: "pointermove",
  POINTER_LEAVE: "pointerleave",
  CONTEXT_MENU: "contextmenu",
  WHEEL: "wheel",
  // Keyboard
  KEY_DOWN: "keydown",
  KEY_PRESS: "keypress",
  KEY_UP: "keyup",
  // HTML Document
  LOAD: "load",
  BEFORE_UNLOAD: "beforeunload",
  UNLOAD: "unload",
  PAGE_SHOW: "pageshow",
  PAGE_HIDE: "pagehide",
  ABORT: "abort",
  ERROR: "error",
  RESIZE: "resize",
  SCROLL: "scroll",
  FULLSCREEN_CHANGE: "fullscreenchange",
  WK_FULLSCREEN_CHANGE: "webkitfullscreenchange",
  // Form
  SELECT: "select",
  CHANGE: "change",
  SUBMIT: "submit",
  RESET: "reset",
  FOCUS: "focus",
  FOCUS_IN: "focusin",
  FOCUS_OUT: "focusout",
  BLUR: "blur",
  INPUT: "input",
  // Local Storage
  STORAGE: "storage",
  // Drag
  DRAG_START: "dragstart",
  DRAG: "drag",
  DRAG_ENTER: "dragenter",
  DRAG_LEAVE: "dragleave",
  DRAG_OVER: "dragover",
  DROP: "drop",
  DRAG_END: "dragend",
} as const;
