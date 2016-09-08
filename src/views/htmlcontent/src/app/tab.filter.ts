import { Pipe, PipeTransform } from '@angular/core';
import { Tab } from './tab';

@Pipe({
    name: 'tabFilter',
    pure: false
})
export class TabFilter implements PipeTransform {
    transform(items: Tab[]): any {
        return items.filter(item => item.show);
    }
}