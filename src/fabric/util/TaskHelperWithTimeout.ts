export class TaskHelperWithTimeout {
    ids: NodeJS.Timeout[] = [];
    #set(delay: number, reason: string) {
        return new Promise<void>((resolve, reject) => {
            const id = setTimeout(() => {
                if (reason === undefined) {
                    resolve();
                }
                else {
                    reject(reason);
                }
                this.#clear(id);
            }, delay);
            this.ids.push(id);
        });
    }
    wrap(promise: any, delay: number, reason: string) {
        return Promise.race([promise, this.#set(delay, reason)]);
    }
    #clear(...ids: NodeJS.Timeout[]) {
        this.ids = this.ids.filter(id => {
            if (ids.includes(id)) {
                //                console.log(`clear timeout ${id}`);
                clearTimeout(id); // ensure a timeout is cleared
                return false;
            }
            return true;
        });
    }
}
