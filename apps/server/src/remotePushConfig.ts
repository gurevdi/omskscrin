import { prisma } from "./prisma.js";
import { getEffectiveDeploy } from "./deployCredentials.js";
import { mapKiosk, probeKioskById } from "./kioskProbe.js";
import { enrichKioskDto } from "./kioskDtoEnrich.js";
import { buildFullKioskJsonConfig } from "./kioskJsonConfig.js";
import {
  deployCredentialsOk,
  deployTransportError,
  isLocalKiosk,
  runDeployScript,
  summarizeDeployOutput,
} from "./remoteDeploy.js";

const running = new Set<string>();

function parseOkLine(text: string, marker: RegExp, fallback: string) {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => marker.test(l))
      ?.replace(/^[^:]+:\s*/i, "") || fallback
  );
}

export async function pushKioskConfig(id: string): Promise<{
  ok: boolean;
  message: string;
  kiosk: ReturnType<typeof mapKiosk> | null;
}> {
  const transportErr = deployTransportError();
  if (transportErr) return { ok: false, message: transportErr, kiosk: null };
  if (running.has(id)) return { ok: false, message: "Применение конфига уже выполняется", kiosk: null };

  const kiosk = await prisma.kiosk.findUnique({
    where: { id },
    include: {
      exhibit: { select: { title: true } },
      wallTarget: { select: { hostname: true, name: true, healthPort: true, peerToken: true } },
    },
  });
  if (!kiosk) return { ok: false, message: "Not found", kiosk: null };

  const isLocal = isLocalKiosk(kiosk.hostname);
  if (!isLocal && !deployCredentialsOk()) {
    return { ok: false, message: "Задайте DEPLOY_USER / DEPLOY_PASSWORD в .env", kiosk: mapKiosk(kiosk) };
  }

  const netCfg = await buildFullKioskJsonConfig(id);
  if (!netCfg) return { ok: false, message: "Not found", kiosk: null };
  const json = JSON.stringify(netCfg, null, 2);

  running.add(id);
  try {
    const args = [
      "-Hostname",
      kiosk.hostname,
      "-ConfigJson",
      json,
      "-HealthPort",
      String(netCfg.healthPort),
    ];
    if (isLocal) args.push("-LocalOnly");
    else {
      const deploy = getEffectiveDeploy();
      args.push("-DeployUser", deploy.user, "-DeployPassword", deploy.password);
    }

    const result = await runDeployScript("remote-push-config", args, { timeoutMs: 120_000 });
    const text = `${result.stdout}\n${result.stderr}`.trim();
    if (/PUSH_OK/i.test(text)) {
      const probed = await probeKioskById(id);
      return {
        ok: true,
        message: parseOkLine(text, /PUSH_OK:/i, "Конфиг применён"),
        kiosk: probed,
      };
    }
    return {
      ok: false,
      message: summarizeDeployOutput(text, result.code) || "Не удалось применить конфиг",
      kiosk: mapKiosk(kiosk),
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Push config failed",
      kiosk: mapKiosk(kiosk),
    };
  } finally {
    running.delete(id);
  }
}
