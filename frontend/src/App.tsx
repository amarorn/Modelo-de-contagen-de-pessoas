import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { RoiPolygonPage } from "./pages/RoiPolygonPage";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gradient-to-br from-[#0a0e12] via-[#0f1419] to-[#0a1628]">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/roi" element={<RoiPolygonPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
