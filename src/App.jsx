import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import SurvivorPool from './pages/SurvivorPool';
import ConfidencePool from './pages/ConfidencePool';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/survivor" element={<SurvivorPool />} />
        <Route path="/confidence" element={<ConfidencePool />} />
      </Routes>
    </HashRouter>
  );
}
