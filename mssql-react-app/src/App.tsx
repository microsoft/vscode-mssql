import './App.css'
import { Routes, Route, useNavigate } from 'react-router-dom';
import { WelcomePage } from './pages/WelcomePage';
import { TableDesigner } from './pages/TableDesignerPage';
import { QueryPlan } from './pages/QueryPlan';
import { FluentProvider, makeStyles, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { useContext, useEffect } from 'react';
import { ColorThemeKind, StateContext } from './StateProvider';

export const useStyles = makeStyles({
  root: {
    height: '100%',
    width: '100%'
  }
});

export type RoutesParam = {
  route: string
}
function App() {
  const state = useContext(StateContext);
  const navigate = useNavigate();
  const className = useStyles();

  useEffect(() => {
    if (state?.state?.route) {
      navigate(state.state.route)
    }
  }, [state?.state?.route, navigate])

  return (
    <FluentProvider className={className.root}  theme={ [ColorThemeKind.Dark, ColorThemeKind.Light].includes(state?.state?.theme ?? ColorThemeKind.Dark) ? webDarkTheme : webLightTheme}>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path='/tableDesigner' element={<TableDesigner />} />
        <Route path='/queryPlan' element={<QueryPlan />} />
      </Routes>
    </FluentProvider>
  )
}

export default App
