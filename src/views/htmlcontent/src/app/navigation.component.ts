import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
    selector: 'navigator',
    templateUrl: 'app/navigation.component.html'
})

export class NavigatorComponent {
    @Input() results: number[];
    @Output() selectionChange: EventEmitter<number> = new EventEmitter<number>();

    public selected(value: number): void {
        this.selectionChange.emit(value);
    }
}
