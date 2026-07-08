import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* The Landing Page */}
        <Route path="/" element={<Home />} />
        
        {/* The Lobby Page */}
        <Route path="/lobby/:lobbyId" element={<Lobby />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
