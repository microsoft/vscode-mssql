import { Component, Input, ContentChild, AfterContentChecked, AfterViewInit, ElementRef, forwardRef, Inject } from '@angular/core';
import { SlickGrid } from './slickgrid/SlickGrid';

enum SelectedTab {
    Results = 0,
    Messages = 1,
}

@Component({
    selector: 'tab',
    styles: [`
        .pane{
        padding: 1em;
        }`],
    template: `
        <div class="boxRow content box">
        <ng-content></ng-content>
        </div>`
})
export class Tab implements AfterContentChecked, AfterViewInit {
    @Input('tabTitle') title: string;
    @Input() _active = false;
    @Input() id: SelectedTab;
    @Input() show: boolean;
    @ContentChild(SlickGrid) slickgrid: SlickGrid;

    constructor(@Inject(forwardRef(() => ElementRef)) private _el: ElementRef) {};

    private updateActive() {
        if (!this._active) {
            this._el.nativeElement.className += ' hidden';
        } else {
            this._el.nativeElement.className = this._el.nativeElement.className.replace( /(?:^|\s)hidden(?!\S)/g , '' )
        }
    }

    public set active(active: boolean) {
        this._active = active;
        this.updateActive();
    }

    public get active(): boolean {
        return this._active;
    }

    ngAfterContentChecked(): void {
        if (this.slickgrid) {
            this.slickgrid.onResize();
        }
    }

    ngAfterViewInit(): void {
        if (this.slickgrid) {
            this.slickgrid.onResize();
        }
    }
}
