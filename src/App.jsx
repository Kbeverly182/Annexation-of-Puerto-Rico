import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import SurvivorPool from './pages/SurvivorPool';
import ConfidencePool from './pages/ConfidencePool';
import LineupPool from './pages/LineupPool';
import PlayerProps from './pages/PlayerProps';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/survivor" element={<SurvivorPool />} />
        <Route path="/confidence" element={<ConfidencePool />} />
        <Route path="/lineup" element={<LineupPool />} />
        <Route path="/props" element={<PlayerProps />} />
      </Routes>
    </HashRouter>
  );
}
