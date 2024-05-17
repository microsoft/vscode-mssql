import { ReactNode, createContext, useEffect, useState } from 'react';
import { rpc } from './utils/rpc';

export enum ColorThemeKind {
	Light = 1,
	Dark = 2,
	HighContrast = 3,
	HighContrastLight = 4
}

export interface PanelState {
	route: string;
	theme: ColorThemeKind;
	state: unknown;
}

export interface StateProps {
	state: PanelState | undefined;
	action: (type: string, payload: unknown) => void;
}

const StateContext = createContext<StateProps | undefined>(undefined);

interface StateProviderProps {
	children: ReactNode;
}

const StateProvider: React.FC<StateProviderProps> = ({ children }) => {
	const [state, setState] = useState<PanelState | undefined>({
		route: '/',
		theme: ColorThemeKind.Light,
		state: undefined
	});
	rpc.subscribe('updateState', (params => {
		setState(params as PanelState);
	}));

	const action = (type: string, payload: unknown) => {
		rpc.call('action', {
			type,
			payload
		});
	}

	useEffect(() => {
	}, []);

	return <StateContext.Provider value={
		{
			state: state,
			action: action
		}
	}>{children}</StateContext.Provider>;
};

export { StateContext, StateProvider };
