import './App.css'
import { Routes, Route, useNavigate } from 'react-router-dom';
import { WelcomePage } from './pages/WelcomePage';
import { TableDesigner } from './pages/TableDesignerPage';
import { QueryPlan } from './pages/QueryPlan';
import { FluentProvider, makeStyles, webDarkTheme, webLightTheme, teamsHighContrastTheme } from '@fluentui/react-components';
import { useContext, useEffect } from 'react';
import { ColorThemeKind, StateContext } from './StateProvider';

export const useStyles = makeStyles({
  root: {
    height: '100%',
    width: '100%',
    color: 'var(--vscode-foreground)',
  }
});

export type RoutesParam = {
  route: string
}
function App() {
  const state = useContext(StateContext);
  const navigate = useNavigate();
  const className = useStyles();
  const getTheme = () => {
    switch (state?.state?.theme) {
      case ColorThemeKind.Dark:
        return webDarkTheme;
      case ColorThemeKind.HighContrast:
        return teamsHighContrastTheme;
      default:
        return webLightTheme;
    }
  }

  useEffect(() => {
    if (state?.state?.route) {
      navigate(state.state.route)
    }
  }, [state?.state?.route, state?.state?.theme, navigate])
  return (
    <FluentProvider className={className.root}  theme={getTheme()}>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path='/tableDesigner' element={<TableDesigner />} />
        <Route path='/queryPlan' element={<QueryPlan />} />
      </Routes>
    </FluentProvider>
  )
}

export default App
