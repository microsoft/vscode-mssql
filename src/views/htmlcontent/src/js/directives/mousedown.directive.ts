/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Directive, Output, EventEmitter, ElementRef, Inject, forwardRef } from '@angular/core';
// import { Observable } from 'rxjs/Rx';

@Directive({
  selector: '[mousedown]'
})
export class MouseDownDirective {
    @Output('mousedown') onMouseDown: EventEmitter<void> = new EventEmitter<void>();

    constructor(@Inject(forwardRef(() => ElementRef)) private _el: ElementRef) {
        const self = this;
        setTimeout(() => {
            let $gridCanvas = $(this._el.nativeElement).find('.grid-canvas');
            $gridCanvas.on('mousedown', () => {
                self.onMouseDown.emit();
            });
            let mouseDownFuncs: any[] = $gridCanvas.data('events')['mousedown'];
            // reverse the event array so that our event fires first.
            mouseDownFuncs.reverse();
        });
    }
}
