import './App.css'
import { Routes, Route, useNavigate } from 'react-router-dom';
import { WelcomePage } from './pages/welcomePage';
import { TableDesigner } from './pages/tableDesigner';
import { QueryPlan } from './pages/QueryPlan';
import { rpc } from './utils/rpc';
export type RoutesParam = {
  route: string
}
function App() {
  const navigate = useNavigate();
  rpc.subscribe('setRoute', (params => {
    console.log('setting route', params);
    const paramparsed = params as RoutesParam;
    navigate(paramparsed.route);
  }));
  return (
    <Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path='/tableDesigner' element={<TableDesigner />} />
      <Route path='/queryPlan' element={<QueryPlan />} />
    </Routes>
  )
}

export default App
