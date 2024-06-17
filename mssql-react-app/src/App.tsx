import './App.css'
import { FluentProvider, makeStyles, webDarkTheme, webLightTheme, teamsHighContrastTheme } from '@fluentui/react-components';
import { useContext, useState } from 'react';
import { ColorThemeKind, StateContext, StateProvider } from './StateProvider';
import { MemoryRouter as Router } from 'react-router-dom';
import { AppRouter } from './Router';
import { ImageProvider } from './imageProvider';
import { vscodeApi } from './main';

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

  const className = useStyles();
  const [theme, setTheme] = useState(webLightTheme);
  const getTheme = (kind: ColorThemeKind) => {
    switch (kind) {
      case ColorThemeKind.Dark:
        return webDarkTheme;
      case ColorThemeKind.HighContrast:
        return teamsHighContrastTheme;
      default:
        return webLightTheme;
    }
  }

  window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
      case 'onDidChangeTheme':
        setTheme(getTheme(message.theme));
        break;
    }
  });

  vscodeApi.postMessage({ type: 'getThemeKind' });

  return <FluentProvider style={{
    height: '100%',
    width: '100%',
    color: 'var(--vscode-foreground)',
  }}  theme={theme}>
    <div className={className.root}>
    <StateProvider>
      <ImageProvider>
        <Router>
          <AppRouter />
        </Router>
      </ImageProvider>
    </StateProvider>
    </div>

  </FluentProvider>
}

export default App
