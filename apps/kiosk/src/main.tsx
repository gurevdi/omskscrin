import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadConfig, type KioskConfig } from "./config";
import { SearchKioskApp, WallKioskApp } from "./modes/MemoryModes";
import { installKioskLockdown } from "./lockdown";
import "./styles.css";
import "./modes/memory.css";

installKioskLockdown();

function Root() {
  const [config, setConfig] = useState<KioskConfig | null>(null);

  useEffect(() => {
    void loadConfig().then(setConfig);
  }, []);

  if (!config) {
    return <div className="mw-boot">Загрузка…</div>;
  }
  if (config.kioskType === "veteran_search") {
    return <SearchKioskApp config={config} />;
  }
  if (config.kioskType === "memory_wall") {
    return <WallKioskApp config={config} />;
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
