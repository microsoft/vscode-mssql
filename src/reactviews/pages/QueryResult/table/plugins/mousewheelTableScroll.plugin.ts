/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../dom';

const SCROLL_WHEEL_SENSITIVITY = 50;

export interface IMouseWheelSupportOptions {
	scrollSpeed?: number;
}

const defaultOptions: IMouseWheelSupportOptions = {
	scrollSpeed: SCROLL_WHEEL_SENSITIVITY
};

export interface IMouseWheelEvent extends MouseEvent {
	readonly wheelDelta: number;
	readonly wheelDeltaX: number;
	readonly wheelDeltaY: number;

	readonly deltaX: number;
	readonly deltaY: number;
	readonly deltaZ: number;
	readonly deltaMode: number;
}

export class MouseWheelSupport implements Slick.Plugin<any> {

	private viewport!: HTMLElement;
	private canvas!: HTMLElement;
	private options: IMouseWheelSupportOptions;

	constructor() {
		this.options = defaultOptions;
	}

	public async init(grid: Slick.Grid<any>): Promise<void> {
		this.canvas = grid.getCanvasNode();
		this.viewport = this.canvas.parentElement!;
		let onMouseWheel = (browserEvent: IMouseWheelEvent) => {
			console.log('mouse wheel event', browserEvent);
			// let e = new StandardWheelEvent(browserEvent);
			// this._onMouseWheel(e);
		};
		DOM.addDisposableListener(this.viewport, 'mousewheel', onMouseWheel);
		DOM.addDisposableListener(this.viewport, 'DOMMouseScroll', onMouseWheel);
	}

	private _onMouseWheel(e: StandardWheelEvent) {
		if (e.deltaY || e.deltaX) {
			let deltaY = e.deltaY * this.options.scrollSpeed!;
			let deltaX = e.deltaX * this.options.scrollSpeed!;
			const scrollHeight = this.canvas.clientHeight;
			const scrollWidth = this.canvas.clientWidth;
			const height = this.viewport.clientHeight;
			const width = this.viewport.clientWidth;

			// Convert vertical scrolling to horizontal if shift is held, this
			// is handled at a higher level on Mac
			const shiftConvert = process.platform !== 'darwin' && e.browserEvent && e.browserEvent.shiftKey;
			if (shiftConvert && !deltaX) {
				deltaX = deltaY;
				deltaY = 0;
			}

			// scroll down
			if (deltaY < 0) {
				if ((this.viewport.scrollTop - deltaY) + height > scrollHeight) {
					this.viewport.scrollTop = scrollHeight - height;
					this.viewport.dispatchEvent(new Event('scroll'));
				} else {
					this.viewport.scrollTop = this.viewport.scrollTop - deltaY;
					this.viewport.dispatchEvent(new Event('scroll'));
					e.stopPropagation();
					e.preventDefault();
				}
				// scroll up
			} else {
				if ((this.viewport.scrollTop - deltaY) < 0) {
					this.viewport.scrollTop = 0;
					this.viewport.dispatchEvent(new Event('scroll'));
				} else {
					this.viewport.scrollTop = this.viewport.scrollTop - deltaY;
					this.viewport.dispatchEvent(new Event('scroll'));
					e.stopPropagation();
					e.preventDefault();
				}
			}

			// scroll left
			if (deltaX < 0) {
				if ((this.viewport.scrollLeft - deltaX) + width > scrollWidth) {
					this.viewport.scrollLeft = scrollWidth - width;
					this.viewport.dispatchEvent(new Event('scroll'));
				} else {
					this.viewport.scrollLeft = this.viewport.scrollLeft - deltaX;
					this.viewport.dispatchEvent(new Event('scroll'));
					e.stopPropagation();
					e.preventDefault();
				}
				// scroll left
			} else {
				if ((this.viewport.scrollLeft - deltaX) < 0) {
					this.viewport.scrollLeft = 0;
					this.viewport.dispatchEvent(new Event('scroll'));
				} else {
					this.viewport.scrollLeft = this.viewport.scrollLeft - deltaX;
					this.viewport.dispatchEvent(new Event('scroll'));
					e.stopPropagation();
					e.preventDefault();
				}
			}
		}
	}

	destroy() {
		console.log('destroy');
		// this._disposables.dispose();
	}
}

interface IWebKitMouseWheelEvent {
	wheelDeltaY: number;
	wheelDeltaX: number;
}

interface IGeckoMouseWheelEvent {
	HORIZONTAL_AXIS: number;
	VERTICAL_AXIS: number;
	axis: number;
	detail: number;
}

//TODO: do I need this?
export class StandardWheelEvent {

	public readonly browserEvent: IMouseWheelEvent | null;
	public readonly deltaY: number;
	public readonly deltaX: number;
	public readonly target: Node;

	constructor(e: IMouseWheelEvent | null, deltaX: number = 0, deltaY: number = 0) {

		this.browserEvent = e || null;
		this.target = e ? (e.target || (<any>e).targetNode || e.srcElement) : null;

		this.deltaY = deltaY;
		this.deltaX = deltaX;

		if (e) {
			// Old (deprecated) wheel events
			const e1 = <IWebKitMouseWheelEvent><any>e;
			const e2 = <IGeckoMouseWheelEvent><any>e;

			// vertical delta scroll
			if (typeof e1.wheelDeltaY !== 'undefined') {
				this.deltaY = e1.wheelDeltaY / 120;
			} else if (typeof e2.VERTICAL_AXIS !== 'undefined' && e2.axis === e2.VERTICAL_AXIS) {
				this.deltaY = -e2.detail / 3;
			} else if (e.type === 'wheel') {
				// Modern wheel event
				// https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent
				const ev = <WheelEvent><unknown>e;

				if (ev.deltaMode === ev.DOM_DELTA_LINE) {
					// the deltas are expressed in lines
					if (process.platform !== 'darwin') {
						this.deltaY = -e.deltaY / 3;
					} else {
						this.deltaY = -e.deltaY;
					}
				} else {
					this.deltaY = -e.deltaY / 40;
				}
			}

			// horizontal delta scroll
			if (typeof e1.wheelDeltaX !== 'undefined') {
				if (process.platform === 'win32') {
					this.deltaX = - (e1.wheelDeltaX / 120);
				} else {
					this.deltaX = e1.wheelDeltaX / 120;
				}
			} else if (typeof e2.HORIZONTAL_AXIS !== 'undefined' && e2.axis === e2.HORIZONTAL_AXIS) {
				this.deltaX = -e.detail / 3;
			} else if (e.type === 'wheel') {
				// Modern wheel event
				// https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent
				const ev = <WheelEvent><unknown>e;

				if (ev.deltaMode === ev.DOM_DELTA_LINE) {
					// the deltas are expressed in lines
					if (browser.isFirefox && process.platform !== 'darwin') {
						this.deltaX = -e.deltaX / 3;
					} else {
						this.deltaX = -e.deltaX;
					}
				} else {
					this.deltaX = -e.deltaX / 40;
				}
			}

			// Assume a vertical scroll if nothing else worked
			if (this.deltaY === 0 && this.deltaX === 0 && e.wheelDelta) {
				this.deltaY = e.wheelDelta / 120;
			}
		}
	}
	public preventDefault(): void {
		this.browserEvent?.preventDefault();
	}

	public stopPropagation(): void {
		this.browserEvent?.stopPropagation();
	}
}
