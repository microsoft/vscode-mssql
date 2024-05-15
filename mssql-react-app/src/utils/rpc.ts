import { vscodeApi } from "../main";

class webViewRpc {
	private rpcId = 0;
	private rpcCallbacks: { [id: number]: { resolve: (result: unknown) => void, reject: (error: unknown) => void } } = {};
	private notificationSubscriptions: { [method: string]: ((params: unknown) => void)[] } = {};

	constructor() {
		window.addEventListener('message', (event) => {
			const message = event.data;
            if (message.type === 'rpcResponse') {
                const { id, result, error } = message;
                if (this.rpcCallbacks[id]) {
                    if (error) {
                        this.rpcCallbacks[id].reject(error);
                    } else {
                        this.rpcCallbacks[id].resolve(result);
                    }
                    delete this.rpcCallbacks[id];
                }
            }
			if (message.type === 'notification') {
				console.log('notification', message, this.notificationSubscriptions);
				const { method, params } = message;
				if (this.notificationSubscriptions[method]) {
					this.notificationSubscriptions[method].forEach(callback => callback(params));
				}
			}
		});

	}

	public call(method: string, params: unknown): Promise<unknown> {
		const id = this.rpcId++;
		vscodeApi.postMessage({ type: 'rpc', id, method, params });
		return new Promise((resolve, reject) => {
			this.rpcCallbacks[id] = { resolve, reject };
		});
	}

	public subscribe(method: string, callback: (params: unknown) => void) {
		if (!this.notificationSubscriptions[method]) {
			this.notificationSubscriptions[method] = [];
		}
		this.notificationSubscriptions[method].push(callback);
	}
}

export const rpc = new webViewRpc();