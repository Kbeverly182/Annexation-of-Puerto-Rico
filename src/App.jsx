import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import SurvivorPool from './pages/SurvivorPool';
import RevivalSurvivorPool from './pages/RevivalSurvivorPool';
import ConfidencePool from './pages/ConfidencePool';
import LineupPool from './pages/LineupPool';
import PlayerProps from './pages/PlayerProps';
import PoultryBowl from './pages/PoultryBowl';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/survivor" element={<SurvivorPool />} />
        <Route path="/revival" element={<RevivalSurvivorPool />} />
        <Route path="/confidence" element={<ConfidencePool />} />
        <Route path="/lineup" element={<LineupPool />} />
        <Route path="/props" element={<PlayerProps />} />
        <Route path="/poultry" element={<PoultryBowl />} />
        <Route path="/poultry-beta" element={<PoultryBowl beta />} />
      </Routes>
    </HashRouter>
  );
}
