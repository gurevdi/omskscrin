import dns from "node:dns/promises";
import { exhibitGameFromRow } from "@stella/shared";
import type { GameCopyDto, KioskType } from "@stella/shared";
import { prisma } from "./prisma.js";
import { config } from "./config.js";
import { getDeployMeta } from "./deployMeta.js";
import { broadcastKioskUpsert } from "./monitorHub.js";
import { getProbeIntervalMs, getProbeTimeoutMs } from "./networkSettings.js";
import { getSoftwareUpdatePending } from "./softwareUpdatePending.js";
import { setGameCopyState, setInstalledGames } from "./gameCopyState.js";
import { enrichKioskDto } from "./kioskDtoEnrich.js";
import type { InstallStatus, ProbeStatus, SyncStatus } from "@prisma/client";

function isOnline(lastSeenAt: Date | null) {
  if (!lastSeenAt) return false;
  return Date.now() - lastSeenAt.getTime() < config.onlineThresholdMs;
}

export function mapKiosk(k: {
  id: string;
  kioskId: string;
  hostname: string;
  name: string;
  healthPort: number;
  uiPort?: number;
  serverUrl?: string | null;
  exhibitId: string | null;
  kioskType?: string | null;
  wallTargetKioskId?: string | null;
  peerToken?: string | null;
  lastSeenAt: Date | null;
  contentVersion: string | null;
  syncStatus: SyncStatus;
  syncMessage: string | null;
  appVersion: string | null;
  softwareVersion?: string | null;
  probeStatus: ProbeStatus;
  probeMessage: string | null;
  lastProbeAt: Date | null;
  installStatus: InstallStatus;
  installStage: string;
  installMessage: string | null;
  lastInstallAt: Date | null;
  exhibit?: {
    title: string;
    gameTitle?: string | null;
    gameShareFolder?: string | null;
    gameExe?: string | null;
  } | null;
  wallTarget?: { hostname: string; name: string } | null;
}, ota?: { target: string | null }) {
  const metaTarget =
    ota?.target !== undefined
      ? ota.target
      : (() => {
          const sw = getDeployMeta().softwareVersion;
          return sw && sw !== "0" ? sw : null;
        })();
  const pending =
    getSoftwareUpdatePending(k.kioskId) || getSoftwareUpdatePending(k.hostname);
  const local = k.softwareVersion ?? null;
  const otaPending = Boolean(
    pending && metaTarget && pending.target === metaTarget && local !== metaTarget
  );
  const exhibitGame = k.exhibit ? exhibitGameFromRow(k.exhibit) : null;
  const kioskType: KioskType =
    k.kioskType === "veteran_search" || k.kioskType === "memory_wall" ? k.kioskType : "exhibit";
  return {
    id: k.id,
    kioskId: k.kioskId,
    hostname: k.hostname,
    name: k.name,
    healthPort: k.healthPort,
    uiPort: k.uiPort ?? 47820,
    serverUrl: k.serverUrl ?? null,
    exhibitId: k.exhibitId,
    exhibitTitle: k.exhibit?.title ?? null,
    exhibitGame,
    kioskType,
    wallTargetKioskId: k.wallTargetKioskId ?? null,
    wallTargetHostname: k.wallTarget?.hostname ?? null,
    wallTargetName: k.wallTarget?.name ?? null,
    peerTokenSet: Boolean(k.peerToken),
    lastSeenAt: k.lastSeenAt?.toISOString() ?? null,
    online: isOnline(k.lastSeenAt),
    contentVersion: k.contentVersion,
    syncStatus: k.syncStatus,
    syncMessage: k.syncMessage,
    appVersion: k.appVersion,
    softwareVersion: local,
    otaTarget: metaTarget,
    otaPending,
    probeStatus: k.probeStatus,
    probeMessage: k.probeMessage,
    lastProbeAt: k.lastProbeAt?.toISOString() ?? null,
    installStatus: k.installStatus,
    installStage: (k.installStage || "idle") as
      | "idle"
      | "queued"
      | "connecting"
      | "copying"
      | "configuring"
      | "installing"
      | "starting"
      | "done"
      | "error",
    installMessage: k.installMessage,
    lastInstallAt: k.lastInstallAt?.toISOString() ?? null,
    policyClearStatus: "idle" as const,
    policyClearStage: "idle" as const,
    policyClearMessage: null,
    uiStartStatus: "idle" as const,
    uiStartStage: "idle" as const,
    uiStartMessage: null,
    uiStopStatus: "idle" as const,
    uiStopStage: "idle" as const,
    uiStopMessage: null,
  };
}

export const kioskExhibitSelect = {
  title: true,
  gameTitle: true,
  gameShareFolder: true,
  gameExe: true,
} as const;

export async function loadKioskSnapshot() {
  const list = await prisma.kiosk.findMany({
    include: {
      exhibit: { select: kioskExhibitSelect },
      wallTarget: { select: { hostname: true, name: true } },
    },
    orderBy: { name: "asc" },
  });
  const sw = getDeployMeta().softwareVersion;
  const otaTarget = sw && sw !== "0" ? sw : null;
  return list.map((k) => mapKiosk(k, { target: otaTarget }));
}

type HealthPayload = {
  ok?: boolean;
  kioskId?: string;
  hostname?: string;
  appVersion?: string;
  softwareVersion?: string;
  contentVersion?: string | null;
  syncStatus?: SyncStatus;
  gameCopy?: GameCopyDto;
  installedGames?: string[];
};

function ingestGameHealth(
  kioskId: string,
  hostname: string,
  health: HealthPayload | null | undefined
) {
  if (!health?.ok) return;
  if (health.gameCopy?.status) {
    setGameCopyState(kioskId, hostname, {
      status: health.gameCopy.status,
      folder: health.gameCopy.folder ?? null,
      percent: health.gameCopy.percent ?? null,
      copiedBytes: health.gameCopy.copiedBytes ?? null,
      totalBytes: health.gameCopy.totalBytes ?? null,
      message: health.gameCopy.message ?? null,
      updatedAt: health.gameCopy.updatedAt ?? new Date().toISOString(),
    });
  }
  if (health.installedGames) {
    setInstalledGames(kioskId, hostname, health.installedGames);
  }
}

async function fetchHealth(hostname: string, port: number): Promise<HealthPayload | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getProbeTimeoutMs());
  try {
    const res = await fetch(`http://${hostname}:${port}/health`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as HealthPayload;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeKioskById(id: string) {
  const kiosk = await prisma.kiosk.findUnique({
    where: { id },
    include: { exhibit: { select: kioskExhibitSelect } },
  });
  if (!kiosk) return null;

  let probeStatus: ProbeStatus = "unknown";
  let probeMessage = "";

  try {
    await dns.lookup(kiosk.hostname);
  } catch {
    probeStatus = "unreachable";
    probeMessage = "Хост не резолвится в DNS / недоступен по имени";
    const updated = await prisma.kiosk.update({
      where: { id },
      data: { probeStatus, probeMessage, lastProbeAt: new Date() },
      include: { exhibit: { select: kioskExhibitSelect } },
    });
    const dto = enrichKioskDto(mapKiosk(updated));
    broadcastKioskUpsert(dto);
    return dto;
  }

  const health = await fetchHealth(kiosk.hostname, kiosk.healthPort);
  ingestGameHealth(kiosk.kioskId, kiosk.hostname, health);
  if (!health?.ok) {
    probeStatus = "no_software";
    const hadInstall = Boolean(kiosk.lastInstallAt) || kiosk.installStatus === "ok";
    probeMessage = hadInstall
      ? `Агент не отвечает на порту ${kiosk.healthPort} — нажмите «Запуск UI» или переустановите софт`
      : `Софт не установлен или агент не запущен (порт ${kiosk.healthPort})`;
  } else {
    const hbOk = isOnline(kiosk.lastSeenAt);
    const syncBad = kiosk.syncStatus === "error";
    if (!hbOk || syncBad) {
      probeStatus = "degraded";
      probeMessage = !hbOk
        ? "Агент отвечает, но нет свежего heartbeat (UI/агент → сервер)"
        : `Агент отвечает, sync: ${kiosk.syncMessage || "error"}`;
    } else {
      probeStatus = "healthy";
      probeMessage = "Софт установлен, агент и heartbeat в норме";
    }
  }

  const updated = await prisma.kiosk.update({
    where: { id },
    data: {
      probeStatus,
      probeMessage,
      lastProbeAt: new Date(),
      // Only trust versions from a live health response (not stale heartbeat leftovers)
      appVersion: health?.ok ? health.appVersion || undefined : undefined,
      softwareVersion: health?.ok ? health.softwareVersion || undefined : undefined,
    },
    include: { exhibit: { select: kioskExhibitSelect } },
  });
  const dto = enrichKioskDto(mapKiosk(updated));
  broadcastKioskUpsert(dto);
  return dto;
}

export async function probeAllKiosks() {
  const list = await prisma.kiosk.findMany({ select: { id: true } });
  for (const row of list) {
    try {
      await probeKioskById(row.id);
    } catch {
      // continue next
    }
  }
}

export function startKioskProbeLoop() {
  const tick = () => {
    void probeAllKiosks();
  };
  tick();
  return setInterval(tick, getProbeIntervalMs());
}

export function normalizeHostname(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}
