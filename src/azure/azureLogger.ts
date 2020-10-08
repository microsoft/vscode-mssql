import Logger from 'ads-adal-library';

export class AzureLogger implements Logger {
    public log(msg: any, ...vals: any[]): void {
        const fullMessage = `${msg} - ${vals.map(v => JSON.stringify(v)).join(' - ')}`;
        console.log(fullMessage);
     }
    public error(msg: any, ...vals: any[]): void {
        const fullMessage = `${msg} - ${vals.map(v => JSON.stringify(v)).join(' - ')}`;
        console.error(fullMessage);
    }
    public pii(msg: any, ...vals: any[]): void {
        const fullMessage = `${msg} - ${vals.map(v => JSON.stringify(v)).join(' - ')}`;
        console.log(fullMessage);
    }
}
