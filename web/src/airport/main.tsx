import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AirportBoard } from "./AirportBoard.js";
import "../styles/airport.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AirportBoard />
  </StrictMode>,
);
