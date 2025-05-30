import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// 初始化主题
const initTheme = () => {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.classList.add(savedTheme);
};

initTheme();

createRoot(document.getElementById("root")!).render(<App />);
