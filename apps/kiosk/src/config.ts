import type { KioskType, KioskWallPeerConfig } from "@stella/shared";

export type KioskGame = {
  /** Button label */
  title: string;
  /** Path relative to ProgramData\StellaKiosk\games or absolute under that folder */
  exe: string;
  args?: string[];
  /** Optional working directory */
  cwd?: string;
};

export type KioskConfig = {
  kioskId: string;
  hostname: string;
  serverUrl: string;
  syncIntervalSec: number;
  idleTimeoutSec: number;
  heartbeatIntervalSec: number;
  healthPort: number;
  appVersion: string;
  /** Optional local game launched via Tauri shell */
  game?: KioskGame | null;
  kioskType?: KioskType;
  wallPeer?: KioskWallPeerConfig | null;
  peerToken?: string;
  wallShowTtlSec?: number;
};

const defaults: KioskConfig = {
  kioskId: "patriotstela1",
  hostname: "patriotstela1",
  serverUrl: "http://localhost:8080",
  syncIntervalSec: 20,
  idleTimeoutSec: 600,
  heartbeatIntervalSec: 30,
  healthPort: 47821,
  appVersion: "0.1.0",
  game: null,
  kioskType: "exhibit",
};

export async function loadConfig(): Promise<KioskConfig> {
  try {
    const res = await fetch("/kiosk.json", { cache: "no-store" });
    if (!res.ok) return defaults;
    const raw = (await res.json()) as Partial<KioskConfig>;
    const hostname = (raw.hostname || raw.kioskId || defaults.hostname).toLowerCase();
    const kioskId = (raw.kioskId || hostname).toLowerCase();
    const game =
      raw.game && raw.game.exe && raw.game.title
        ? {
            title: String(raw.game.title),
            exe: String(raw.game.exe),
            args: Array.isArray(raw.game.args) ? raw.game.args.map(String) : [],
            cwd: raw.game.cwd ? String(raw.game.cwd) : undefined,
          }
        : null;
    const kioskType =
      raw.kioskType === "veteran_search" || raw.kioskType === "memory_wall"
        ? raw.kioskType
        : "exhibit";
    const wallPeer =
      raw.wallPeer && raw.wallPeer.hostname && raw.wallPeer.token
        ? {
            hostname: String(raw.wallPeer.hostname).toLowerCase(),
            healthPort: Number(raw.wallPeer.healthPort) || 47821,
            token: String(raw.wallPeer.token),
          }
        : null;
    return {
      ...defaults,
      ...raw,
      hostname,
      kioskId,
      game,
      kioskType,
      wallPeer,
      wallShowTtlSec: Number(raw.wallShowTtlSec) > 0 ? Number(raw.wallShowTtlSec) : 900,
    };
  } catch {
    return defaults;
  }
}
