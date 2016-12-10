import { TestBed, async } from '@angular/core/testing';
import { ValueProvider } from '@angular/core';
import { ShortcutService } from './../src/js/services/shortcuts.service';
import { DataService } from './../src/js/services/data.service';

const WINDOW_PROVIDER: ValueProvider = {
    provide: Window,
    useValue: window
};

// Mock Setup
class MockDataService {
    private _shortcuts = {
        'event.toggleResultPane': 'ctrl+alt+r',
        'event.toggleMessagePane': 'ctrl+alt+y',
        'event.prevGrid': 'ctrl+up',
        'event.nextGrid': 'ctrl+down',
        'event.copySelection': 'ctrl+c',
        'event.maximizeGrid': 'ctrl+shift+alt+y',
        'event.selectAll': 'alt+y',
        'event.saveAsJSON': 'shift+up',
        'event.saveAsCSV': ''
    };
    public doNotResolve: boolean = false;
    private resolveObject;

    get shortcuts(): Promise<any> {
        const self = this;
        if (this.doNotResolve) {
            return new Promise((resolve) => {
                self.resolveObject = resolve;
            });
        } else {
            return Promise.resolve(this._shortcuts);
        }
    }

    public resolveShortcuts(): void {
        if (this.resolveObject) {
            this.resolveObject(this._shortcuts);
            this.resolveObject = undefined;
        }
    }
}

class MockDataServiceNoResolve extends MockDataService {
    public doNotResolve: boolean = true;
}

describe('shortcut service', () => {
    let shortcutService: ShortcutService;
    beforeEach(async(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                ShortcutService,
                WINDOW_PROVIDER,
                {
                    provide: DataService,
                    useClass: MockDataService
                }
            ]
        });
        shortcutService = TestBed.get(ShortcutService);
    }));

    describe('string code for', () => {
        it('should return correct stringCodes', (done) => {
            let testPromises = [];
            testPromises.push(shortcutService.stringCodeFor('event.toggleMessagePane').then((result) => {
                expect(result).toMatch(/(Ctrl\+Alt\+y)|(⌘\+⌥\+y)/g);
            }));
            testPromises.push(shortcutService.stringCodeFor('event.prevGrid').then((result) => {
                expect(result).toMatch(/(Ctrl\+up)|(⌘\+up)/g);
            }));
            testPromises.push(shortcutService.stringCodeFor('event.maximizeGrid').then((result) => {
                expect(result).toMatch(/(Ctrl\+Shift\+Alt\+y)|(⌘\+⇧\+⌥\+y)/g);
            }));
            testPromises.push(shortcutService.stringCodeFor('event.selectAll').then((result) => {
                expect(result).toMatch(/(Alt\+y)|(⌥\+y)/g);
            }));
            testPromises.push(shortcutService.stringCodeFor('event.saveAsJSON').then((result) => {
                expect(result).toMatch(/(Shift\+up)|(⇧\+up)/g);
            }));

            Promise.all(testPromises).then(() => {
                done();
            });
        });

        it('should return undefined for events that do not exist', (done) => {
            shortcutService.stringCodeFor('noneexistant').then((result) => {
                expect(result).toBeUndefined();
                done();
            });
        });

        it('should return correct code even if it is waiting', (done) => {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    ShortcutService,
                    WINDOW_PROVIDER,
                    {
                        provide: DataService,
                        useClass: MockDataServiceNoResolve
                    }
                ]
            });
            let shortcut = TestBed.get(ShortcutService);
            let mockData = <MockDataService> TestBed.get(DataService);
            shortcut.stringCodeFor('event.saveAsJSON').then((result) => {
                expect(result).toMatch(/(Shift\+up)|(⇧\+up)/g);
                done();
            });
            mockData.resolveShortcuts();
        });

        it('should return correct code on all windows', (done) => {
            let mockWindow = {
                navigator: {
                    platform: 'windows'
                }
            };
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    ShortcutService,
                    {
                        provide: DataService,
                        useClass: MockDataService
                    },
                    {
                        provide: Window,
                        useValue: mockWindow
                    }
                ]
            });
            let shortcut = TestBed.get(ShortcutService);
            shortcut.stringCodeFor('event.saveAsJSON').then((result) => {
                expect(result).toEqual('Shift+up');
                done();
            });
        });

        it('should return correct code on all linux', (done) => {
            let mockWindow = {
                navigator: {
                    platform: 'linux'
                }
            };
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    ShortcutService,
                    {
                        provide: DataService,
                        useClass: MockDataService
                    },
                    {
                        provide: Window,
                        useValue: mockWindow
                    }
                ]
            });
            let shortcut = TestBed.get(ShortcutService);
            shortcut.stringCodeFor('event.saveAsJSON').then((result) => {
                expect(result).toEqual('Shift+up');
                done();
            });
        });

        it('should return correct code on all mac', (done) => {
            let mockWindow = {
                navigator: {
                    platform: 'mac'
                }
            };
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    ShortcutService,
                    {
                        provide: DataService,
                        useClass: MockDataService
                    },
                    {
                        provide: Window,
                        useValue: mockWindow
                    }
                ]
            });
            let shortcut = TestBed.get(ShortcutService);
            shortcut.stringCodeFor('event.saveAsJSON').then((result) => {
                expect(result).toEqual('⇧+up');
                done();
            });
        });
    });

    describe('get event', () => {
        it('should return the correct event', (done) => {
            let testPromises = [];
            testPromises.push(shortcutService.getEvent('ctrl+alt+r').then((result) => {
                expect(result).toEqual('event.toggleResultPane');
            }));
            testPromises.push(shortcutService.getEvent('alt+y').then((result) => {
                expect(result).toEqual('event.selectAll');
            }));

            Promise.all(testPromises).then(() => {
                done();
            });
        });

        it('should return undefined for shortcuts that do not exist', (done) => {
            shortcutService.getEvent('alt+down').then((result) => {
                expect(result).toBeUndefined();
                done();
            });
        });

        it('should return correct event even if it is waiting', (done) => {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    ShortcutService,
                    WINDOW_PROVIDER,
                    {
                        provide: DataService,
                        useClass: MockDataServiceNoResolve
                    }
                ]
            });
            let shortcut = TestBed.get(ShortcutService);
            let mockData = <MockDataService> TestBed.get(DataService);
            shortcut.getEvent('alt+y').then((result) => {
                expect(result).toEqual('event.selectAll');
                done();
            });
            mockData.resolveShortcuts();
        });
    });

    describe('build event string', () => {
        it('should build a correct string given valid object', () => {
            expect(shortcutService.buildEventString({
                ctrlKey: true,
                altKey: true,
                shiftKey: true,
                which: 74
            })).toEqual('ctrl+alt+shift+j');
            expect(shortcutService.buildEventString({
                metaKey: true,
                altKey: true,
                shiftKey: true,
                which: 78
            })).toEqual('ctrl+alt+shift+n');
            expect(shortcutService.buildEventString({
                which: 78
            })).toEqual('n');
            expect(shortcutService.buildEventString({
                ctrlKey: true,
                which: 37
            })).toEqual('ctrl+left');
        });
    });
});
