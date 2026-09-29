import { config } from "./config.js";
import { ensureSiteSettings } from "./siteSettings.js";

export type SiteNetworkSettings = {
  serverPublicUrl: string;
  defaultHealthPort: number;
  defaultUiPort: number;
  corsOrigins: string;
  probeIntervalMs: number;
  probeTimeoutMs: number;
};

export type KioskNetworkConfig = {
  serverUrl: string;
  healthPort: number;
  uiPort: number;
};

let cachedProbeIntervalMs = config.probeIntervalMs;
let cachedProbeTimeoutMs = config.probeTimeoutMs;

export function getProbeIntervalMs() {
  return cachedProbeIntervalMs;
}

export function getProbeTimeoutMs() {
  return cachedProbeTimeoutMs;
}

export async function loadNetworkRuntimeFromDb() {
  const s = await ensureSiteSettings();
  cachedProbeIntervalMs = s.probeIntervalMs || config.probeIntervalMs;
  cachedProbeTimeoutMs = s.probeTimeoutMs || config.probeTimeoutMs;
}

export async function getSiteNetworkSettings(): Promise<SiteNetworkSettings> {
  const s = await ensureSiteSettings();
  return {
    serverPublicUrl: (s.serverPublicUrl?.trim() || config.serverPublicUrl).replace(/\/$/, ""),
    defaultHealthPort: s.defaultHealthPort || 47821,
    defaultUiPort: s.defaultUiPort || 47820,
    corsOrigins: s.corsOrigins?.trim() ?? "",
    probeIntervalMs: s.probeIntervalMs || config.probeIntervalMs,
    probeTimeoutMs: s.probeTimeoutMs || config.probeTimeoutMs,
  };
}

export function resolveKioskNetwork(
  kiosk: { healthPort: number; uiPort: number; serverUrl?: string | null },
  site: SiteNetworkSettings
): KioskNetworkConfig {
  return {
    serverUrl: (kiosk.serverUrl?.trim() || site.serverPublicUrl).replace(/\/$/, ""),
    healthPort: kiosk.healthPort || site.defaultHealthPort,
    uiPort: kiosk.uiPort || site.defaultUiPort,
  };
}

export function buildKioskJsonConfig(
  kiosk: {
    kioskId: string;
    hostname: string;
    healthPort: number;
    uiPort: number;
    serverUrl?: string | null;
    appVersion?: string | null;
    kioskType?: string | null;
    peerToken?: string | null;
    wallPeer?: {
      hostname: string;
      healthPort: number;
      token: string;
    } | null;
  },
  site: SiteNetworkSettings,
  gameShareUnc?: string | null
) {
  const net = resolveKioskNetwork(kiosk, site);
  const unc = String(gameShareUnc || "").trim();
  const kioskType =
    kiosk.kioskType === "veteran_search" || kiosk.kioskType === "memory_wall"
      ? kiosk.kioskType
      : "exhibit";
  return {
    hostname: kiosk.hostname.toLowerCase(),
    kioskId: kiosk.kioskId.toLowerCase(),
    serverUrl: net.serverUrl,
    syncIntervalSec: 60,
    /** OTA poll — every 5s so «Обновить ПО» / новый пакет подхватываются быстро */
    softwareCheckIntervalSec: 5,
    idleTimeoutSec: 600,
    heartbeatIntervalSec: 30,
    healthPort: net.healthPort,
    uiPort: net.uiPort,
    appVersion: kiosk.appVersion?.trim() || "0.1.0",
    kioskType,
    ...(kioskType === "memory_wall" && kiosk.peerToken
      ? { peerToken: kiosk.peerToken, wallShowTtlSec: 900 }
      : {}),
    ...(kioskType === "veteran_search" && kiosk.wallPeer
      ? { wallPeer: kiosk.wallPeer, wallShowTtlSec: 900 }
      : {}),
    ...(unc && kioskType === "exhibit" ? { gameShareUnc: unc.replace(/\/$/, "") } : {}),
  };
}

export function getRuntimeNetworkInfo() {
  const host = config.host;
  const port = config.port;
  const bind =
    host === "0.0.0.0" ? `http://127.0.0.1:${port}` : `http://${host}:${port}`;
  return {
    host,
    port,
    bindUrl: bind,
    publicUrl: config.serverPublicUrl,
    corsFromEnv: config.corsOrigin,
    monitorStreamPath: "/api/kiosks/monitor/stream",
    monitorStreamUrl: `${config.serverPublicUrl || bind}/api/kiosks/monitor/stream`,
    apiHealthPath: "/api/health",
    envRequiresRestart: ["PORT", "HOST", "SERVE_ADMIN"],
  };
}

export function parseCorsOrigins(raw: string) {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function getEffectiveCorsOrigins() {
  const site = await getSiteNetworkSettings();
  if (site.corsOrigins) return parseCorsOrigins(site.corsOrigins);
  return config.corsOrigin;
}
