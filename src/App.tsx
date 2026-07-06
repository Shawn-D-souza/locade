import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Party from './pages/Party';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* The Landing Page */}
        <Route path="/" element={<Home />} />
        
        {/* The Lobby Page */}
        <Route path="/party/:partyId" element={<Party />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
