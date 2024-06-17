import { useContext, useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { StateContext } from "./StateProvider";
import { WelcomePage } from "./pages/welcomePage";
import { TableDesignerStateProvider } from "./pages/TableDesigner/TableDesignerStateProvider";
import { TableDesigner } from "./pages/TableDesigner/TableDesignerPage";
import { QueryPlan } from "./pages/QueryPlan";

export const AppRouter = () => {
	const navigate = useNavigate();
	const state = useContext(StateContext);
	useEffect(() => {
		if (state?.state?.route) {
			navigate(state.state.route)
		}
	}, [state?.state?.route, state?.state?.theme, navigate])

	return <Routes>
		<Route path="/" element={<WelcomePage />} />
		<Route path='/tableDesigner' element={<TableDesignerStateProvider><TableDesigner /></TableDesignerStateProvider>} />
		<Route path='/queryPlan' element={<QueryPlan />} />
	</Routes>;
}