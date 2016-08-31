import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
    selector: 'navigator',
    templateUrl: 'app/navigation.component.html'
})

export class NavigatorComponent {
    @Input() batches: number[][];
    @Output() selectionChange: EventEmitter<{ batch: number; result: number; }> = new EventEmitter<{ batch: number; result: number; }>();

    public selected(value: {batch: number; result: number; }): void {
        this.selectionChange.emit(value);
    }
}
