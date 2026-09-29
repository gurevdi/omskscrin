import type { InstallStage } from "@stella/shared";
import { INSTALL_STAGE_LABEL } from "@stella/shared";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { prisma } from "./prisma.js";
import { config } from "./config.js";
import { getEffectiveDeploy } from "./deployCredentials.js";
import { mapKiosk, probeKioskById } from "./kioskProbe.js";
import { enrichKioskDto } from "./kioskDtoEnrich.js";
import { broadcastKioskUpsert } from "./monitorHub.js";
import { getSiteNetworkSettings, resolveKioskNetwork } from "./networkSettings.js";
import { buildFullKioskJsonConfig } from "./kioskJsonConfig.js";
import { pushKioskConfig } from "./remotePushConfig.js";
import {
  deployTransportError,
  isLocalKiosk,
  killDeployProcessTree,
  runDeployScript,
  summarizeDeployOutput,
} from "./remoteDeploy.js";

type InstallJob = {
  proc: ChildProcess | null;
  cancelled: boolean;
};

const jobs = new Map<string, InstallJob>();
const cancelRequested = new Set<string>();
const clearTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function deployPackageReady() {
  return (
    existsSync(path.join(config.deployPackageDir, "agent.mjs")) &&
    existsSync(path.join(config.deployPackageDir, "ui", "index.html"))
  );
}

function isStage(s: string): s is InstallStage {
  return s in INSTALL_STAGE_LABEL;
}

function scheduleInstallIdle(id: string, delayMs: number) {
  const prev = clearTimers.get(id);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    clearTimers.delete(id);
    void (async () => {
      try {
        const row = await prisma.kiosk.findUnique({ where: { id }, select: { installStatus: true } });
        if (!row || (row.installStatus !== "ok" && row.installStatus !== "error")) return;
        await setInstall(id, "idle", "idle", null);
      } catch {
        /* ignore */
      }
    })();
  }, delayMs);
  clearTimers.set(id, t);
}

async function setInstall(
  id: string,
  installStatus: "idle" | "queued" | "running" | "ok" | "error",
  installStage: InstallStage,
  installMessage: string | null
) {
  try {
    const k = await prisma.kiosk.update({
      where: { id },
      data: {
        installStatus,
        installStage,
        installMessage,
        lastInstallAt: new Date(),
      },
      include: { exhibit: { select: { title: true } } },
    });
    const dto = enrichKioskDto(mapKiosk(k));
    broadcastKioskUpsert(dto);
    return dto;
  } catch {
    return null;
  }
}

function inferStageFromLine(line: string): InstallStage | null {
  const m = /STAGE:([a-z_]+)/i.exec(line);
  if (m && isStage(m[1].toLowerCase())) return m[1].toLowerCase() as InstallStage;
  if (/Connecting via WinRM|Connecting via SSH|Local install|New-PSSession/i.test(line)) return "connecting";
  if (/Copying package|Copying portable Node|SMB copy|WinRM zip|via scp/i.test(line)) return "copying";
  if (/kiosk\.json|configur|Extracting/i.test(line)) return "configuring";
  if (/install-local:|Running local installer|install-local failed/i.test(line)) return "installing";
  if (/INSTALL_OK|OK installed/i.test(line)) return "starting";
  return null;
}

function isProgressLine(line: string) {
  return /^(STAGE:|Connecting via|Trying SMB|SMB copy|SMB failed|SMB unavailable|WinRM |Copying package|Extracting|Stopping previous|Running local|Local install|install-local:|Building package|Could not read remote|timed out after|cmd :|The network connection could not be found)/i.test(
    line.trim()
  );
}

export function clearInstallCancelRequest(id: string) {
  cancelRequested.delete(id);
}

export async function cancelKioskInstall(id: string) {
  cancelRequested.add(id);
  const job = jobs.get(id);
  if (job) {
    job.cancelled = true;
    if (job.proc) killDeployProcessTree(job.proc);
  }

  const kiosk = await prisma.kiosk.findUnique({
    where: { id },
    include: { exhibit: { select: { title: true } } },
  });
  if (!kiosk) {
    cancelRequested.delete(id);
    return null;
  }

  if (kiosk.installStatus !== "running" && kiosk.installStatus !== "queued" && !job) {
    cancelRequested.delete(id);
    return enrichKioskDto(mapKiosk(kiosk));
  }

  return setInstall(id, "idle", "idle", "Установка отменена");
}

export async function startKioskInstall(id: string) {
  const transportErr = deployTransportError();
  if (transportErr) {
    return setInstall(id, "error", "error", transportErr);
  }
  if (!deployPackageReady()) {
    return setInstall(
      id,
      "error",
      "error",
      "Нет пакета установки — выполните pnpm pack:kiosk-deploy на сервере"
    );
  }
  if (jobs.has(id)) {
    const k = await prisma.kiosk.findUnique({
      where: { id },
      include: { exhibit: { select: { title: true } } },
    });
    return k ? mapKiosk(k) : null;
  }

  const kiosk = await prisma.kiosk.findUnique({ where: { id } });
  if (!kiosk) return null;

  const isLocal = isLocalKiosk(kiosk.hostname);

  const deploy = getEffectiveDeploy();
  if (
    !isLocal &&
    (!deploy.user ||
      (!deploy.password && !deploy.sshKeyPath) ||
      /^domain\\/i.test(deploy.user) ||
      deploy.user.toLowerCase() === "domain\\admin")
  ) {
    return setInstall(
      id,
      "error",
      "error",
      "Задайте доменную учётку в Настройки → Windows (или DEPLOY_USER / DEPLOY_PASSWORD в .env)"
    );
  }

  const job: InstallJob = { proc: null, cancelled: cancelRequested.has(id) };
  jobs.set(id, job);

  if (job.cancelled || cancelRequested.has(id)) {
    jobs.delete(id);
    cancelRequested.delete(id);
    return setInstall(id, "idle", "idle", "Установка отменена");
  }

  await setInstall(id, "queued", "queued", INSTALL_STAGE_LABEL.queued);

  const site = await getSiteNetworkSettings();
  const net = resolveKioskNetwork(kiosk, site);
  const fullCfg = await buildFullKioskJsonConfig(id);
  const configJson = fullCfg ? JSON.stringify(fullCfg) : "";

  const args = [
    "-Hostname",
    kiosk.hostname,
    "-ServerUrl",
    net.serverUrl,
    "-PackageDir",
    config.deployPackageDir,
    "-KioskId",
    kiosk.kioskId,
    "-HealthPort",
    String(net.healthPort),
    "-UiPort",
    String(net.uiPort),
    "-AppVersion",
    "0.1.0",
  ];
  if (configJson) {
    args.push("-ConfigJson", configJson);
  }
  if (isLocal) {
    args.push("-LocalOnly");
  } else if (deploy.user && deploy.password) {
    args.push("-DeployUser", deploy.user, "-DeployPassword", deploy.password);
  }

  try {
    if (job.cancelled) {
      return setInstall(id, "idle", "idle", "Установка отменена");
    }

    await setInstall(id, "running", "connecting", INSTALL_STAGE_LABEL.connecting);

    let lastStage: InstallStage = "connecting";
    let progressTimer: ReturnType<typeof setTimeout> | null = null;
    const result = await runDeployScript("remote-install", args, {
      timeoutMs: 900_000,
      onLine: (line) => {
        const stage = inferStageFromLine(line);
        if (stage && !job.cancelled && stage !== lastStage) {
          lastStage = stage;
          void setInstall(id, "running", stage, INSTALL_STAGE_LABEL[stage]);
        }
        if (job.cancelled) return;
        if (progressTimer) clearTimeout(progressTimer);
        if (isProgressLine(line) && !/^STAGE:/i.test(line)) {
          progressTimer = setTimeout(() => {
            void setInstall(id, "running", lastStage, line.trim().slice(0, 200));
          }, 200);
        }
      },
      onSpawn: (ps) => {
        job.proc = ps;
        if (job.cancelled) killDeployProcessTree(ps);
      },
    });
    if (progressTimer) clearTimeout(progressTimer);

    if (job.cancelled) {
      return setInstall(id, "idle", "idle", "Установка отменена");
    }

    const text = `${result.stdout}\n${result.stderr}`.trim();
    if (/INSTALL_OK/i.test(text) || /OK installed/i.test(text)) {
      const dto = await setInstall(id, "ok", "done", INSTALL_STAGE_LABEL.done);
      try {
        // Ensure kioskType / wallPeer land in kiosk.json (SSH path may skip ConfigJson)
        await pushKioskConfig(id);
      } catch {
        /* install ok even if push fails — admin can «Применить kiosk.json» */
      }
      try {
        await probeKioskById(id);
      } catch {
        /* install succeeded even if probe races */
      }
      scheduleInstallIdle(id, 12_000);
      return dto;
    }
    const errDto = await setInstall(
      id,
      "error",
      "error",
      summarizeDeployOutput(text, result.code) || `Ошибка на этапе «${lastStage}»`
    );
    scheduleInstallIdle(id, 45_000);
    return errDto;
  } catch (e) {
    if (job.cancelled) {
      return setInstall(id, "idle", "idle", "Установка отменена");
    }
    const errDto = await setInstall(
      id,
      "error",
      "error",
      e instanceof Error ? e.message : "Install failed to start"
    );
    scheduleInstallIdle(id, 45_000);
    return errDto;
  } finally {
    jobs.delete(id);
    cancelRequested.delete(id);
  }
}
