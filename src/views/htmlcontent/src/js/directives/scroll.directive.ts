/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Directive,
    Output,
    EventEmitter,
    ElementRef,
    Inject,
    forwardRef,
    Input,
} from "@angular/core";
import { Observable } from "rxjs/Observable";

@Directive({
    selector: "[onScroll]",
})
export class ScrollDirective {
    @Input() scrollEnabled: boolean = true;
    @Output("onScroll") onScroll: EventEmitter<number> = new EventEmitter<number>();

    constructor(@Inject(forwardRef(() => ElementRef)) private _el: ElementRef) {
        const self = this;
        Observable.fromEvent(this._el.nativeElement, "scroll").subscribe((event) => {
            if (self.scrollEnabled) {
                self.onScroll.emit(self._el.nativeElement.scrollTop);
            }
        });
    }
}
