import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { authenticate, requireRoles } from "../auth.js";
import {
  addMonitorClient,
  broadcastKioskRemoved,
  broadcastKioskUpsert,
  broadcastSnapshot,
  monitorClientCount,
  sendToClient,
} from "../monitorHub.js";
import {
  loadKioskSnapshot,
  mapKiosk,
  normalizeHostname,
  probeKioskById,
} from "../kioskProbe.js";
import { expandHostname, getEffectiveDeploy, refreshDeployCredentialsFromDb } from "../deployCredentials.js";
import { testWindowsHostConnection } from "../deployTest.js";
import type { Prisma } from "@prisma/client";
import { getGlobalAdsState, syncFingerprint } from "./ads.js";
import { ensureSiteSettings } from "../siteSettings.js";
import { buildKioskManifest, exhibitMediaInclude } from "../kioskManifest.js";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { cancelKioskInstall, clearInstallCancelRequest, deployPackageReady, startKioskInstall } from "../remoteInstall.js";
import { enrichKioskDto } from "../kioskDtoEnrich.js";
import { resolveKioskTypeFields } from "../kioskType.js";
import { setGameCopyState, setInstalledGames } from "../gameCopyState.js";
import { requestClearKioskPolicies } from "../remoteClearPolicies.js";
import { requestStartKioskRuntime } from "../remoteStart.js";
import { requestStopKioskRuntime } from "../remoteStop.js";
import {
  requestBulkSoftwareUpdate,
  requestKioskSoftwareUpdate,
} from "../remoteSoftwareUpdate.js";
import {
  requestKioskGameInstall,
  requestKioskGameUninstall,
} from "../remoteGameInstall.js";
import {
  acknowledgeSoftwareVersion,
  getSoftwareUpdatePending,
} from "../softwareUpdatePending.js";
import { prepareKioskDeletion } from "../kioskDeletion.js";
import { uninstallKioskRuntime } from "../remoteUninstall.js";
import { pushKioskConfig } from "../remotePushConfig.js";
import { getDeployMeta, getDeployStatusDetail } from "../deployMeta.js";
import {
  normalizeHhMm,
  parseThemeMode,
  resolveEffectiveTheme,
} from "../themeSchedule.js";
import { addContentClient, broadcastContentSync, sendContentHello } from "../contentHub.js";

function resolveKioskHostname(raw: string) {
  return expandHostname(normalizeHostname(raw), getEffectiveDeploy().domainSuffix);
}

/** Match short name (itpc07) or FQDN (itpc07.udhb.local) against kioskId/hostname. */
function kioskHostWhere(raw: string) {
  const key = normalizeHostname(raw);
  const fqdn = resolveKioskHostname(raw);
  const keys = [...new Set([key, fqdn, raw].filter(Boolean))];
  return {
    OR: keys.flatMap((k) => [{ kioskId: k }, { hostname: k }]),
  };
}

function bumpSettingsVersion(current: string) {
  const n = Number(current);
  if (Number.isFinite(n)) return String(n + 1);
  return createHash("sha1").update(`${current}-${Date.now()}`).digest("hex").slice(0, 12);
}

const kioskSchema = z.object({
  hostname: z.string().min(1),
  name: z.string().min(1).optional(),
  healthPort: z.number().int().min(1).max(65535).optional(),
  uiPort: z.number().int().min(1).max(65535).optional(),
  serverUrl: z.union([z.string().url(), z.literal("")]).nullable().optional(),
  exhibitId: z.string().nullable().optional(),
  kioskType: z.enum(["exhibit", "veteran_search", "memory_wall"]).optional(),
  wallTargetKioskId: z.string().nullable().optional(),
  installSoftware: z.boolean().optional(),
});

const heartbeatSchema = z.object({
  contentVersion: z.string().nullable().optional(),
  syncStatus: z.enum(["ok", "error", "unknown"]).optional(),
  syncMessage: z.string().nullable().optional(),
  appVersion: z.string().nullable().optional(),
  softwareVersion: z.string().nullable().optional(),
  hostname: z.string().optional(),
  gameShare: z
    .object({
      folders: z
        .array(
          z.object({
            name: z.string().min(1).max(200),
            exes: z.array(z.string().max(400)).max(80),
          })
        )
        .max(200),
    })
    .optional(),
  gameCopy: z
    .object({
      status: z.enum(["idle", "copying", "launching", "running", "error"]),
      folder: z.string().max(260).nullable().optional(),
      percent: z.number().min(0).max(100).nullable().optional(),
      copiedBytes: z.number().nonnegative().nullable().optional(),
      totalBytes: z.number().nonnegative().nullable().optional(),
      message: z.string().max(400).nullable().optional(),
      updatedAt: z.string().max(40).nullable().optional(),
    })
    .optional(),
  installedGames: z.array(z.string().min(1).max(200)).max(80).optional(),
});

export async function registerKioskRoutes(app: FastifyInstance) {
  const refreshTimer = setInterval(async () => {
    if (monitorClientCount() === 0) return;
    try {
      broadcastSnapshot((await loadKioskSnapshot()).map(enrichKioskDto));
    } catch (err) {
      app.log.error(err);
    }
  }, 5000);
  app.addHook("onClose", async () => clearInterval(refreshTimer));

  app.get("/api/kiosks/monitor/stream", async (request, reply) => {
    const q = request.query as { token?: string };
    const token = q.token || request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    try {
      await app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    addMonitorClient(reply.raw);

    try {
      const kiosks = await loadKioskSnapshot();
      sendToClient(reply.raw, "snapshot", { kiosks, at: new Date().toISOString() });
    } catch (err) {
      app.log.error(err);
      sendToClient(reply.raw, "error", { message: "Failed to load snapshot" });
    }

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    request.raw.on("close", () => clearInterval(heartbeat));
  });

  app.get("/api/kiosks", { preHandler: authenticate }, async () => {
    const list = await loadKioskSnapshot();
    return list.map(enrichKioskDto);
  });

  app.get("/api/kiosks/deploy/status", { preHandler: authenticate }, async () => getDeployStatusDetail());

  app.post(
    "/api/kiosks/test-connection",
    { preHandler: requireRoles("admin", "editor") },
    async (request) => {
      const body = z.object({ hostname: z.string().min(1) }).parse(request.body);
      await refreshDeployCredentialsFromDb();
      return testWindowsHostConnection(body.hostname);
    }
  );

  /** Wipe Stella from all kiosk PCs (tasks, folder, keyboard policies) and reset global lockdown settings. */
  app.post(
    "/api/kiosks/rollback-all",
    { preHandler: requireRoles("admin", "editor") },
    async (request) => {
      const body = z
        .object({
          /** Also delete kiosk rows from admin DB (default: keep for reinstall) */
          removeFromAdmin: z.boolean().optional(),
        })
        .parse(request.body ?? {});

      const list = await prisma.kiosk.findMany({
        orderBy: { hostname: "asc" },
        select: { id: true, hostname: true, name: true },
      });

      const results: Array<{
        id: string;
        hostname: string;
        name: string;
        ok: boolean;
        message: string;
        removedFromAdmin: boolean;
      }> = [];

      for (const k of list) {
        const un = await uninstallKioskRuntime(k.id);
        let removedFromAdmin = false;
        if (body.removeFromAdmin) {
          try {
            await prisma.kiosk.delete({ where: { id: k.id } });
            broadcastKioskRemoved(k.id);
            removedFromAdmin = true;
          } catch {
            /* keep row if already gone */
          }
        } else {
          // Clear install status so UI does not look "running"
          try {
            await prisma.kiosk.update({
              where: { id: k.id },
              data: {
                installStatus: "idle",
                installStage: "idle",
                installMessage: un.ok ? "Откат: софт снят с ПК" : `Откат с ошибкой: ${un.message}`,
                syncStatus: "unknown",
                syncMessage: un.ok ? "софт удалён с ПК" : un.message,
              },
            });
            const probed = await probeKioskById(k.id);
            if (probed) broadcastKioskUpsert(probed);
          } catch {
            /* ignore */
          }
        }
        results.push({
          id: k.id,
          hostname: k.hostname,
          name: k.name,
          ok: un.ok,
          message: un.message,
          removedFromAdmin,
        });
      }

      const settings = await ensureSiteSettings();
      await prisma.siteSettings.update({
        where: { id: "default" },
        data: {
          softwareEnabled: true,
          blockKeyboard: false,
          settingsVersion: bumpSettingsVersion(settings.settingsVersion),
        },
      });

      const okCount = results.filter((r) => r.ok).length;
      return {
        ok: results.length === 0 || okCount === results.length,
        total: results.length,
        okCount,
        failCount: results.length - okCount,
        results,
        settings: {
          softwareEnabled: true,
          blockKeyboard: false,
        },
        message:
          results.length === 0
            ? "Киосков в списке нет — ограничения в настройках сброшены"
            : `Откат: ${okCount}/${results.length} ПК очищены; клавиатура и глобальный выкл. сброшены`,
      };
    }
  );

  app.post(
    "/api/kiosks/software-update",
    { preHandler: requireRoles("admin", "editor") },
    async (request) => {
      const body = z
        .object({ ids: z.array(z.string()).optional() })
        .parse(request.body ?? {});
      return requestBulkSoftwareUpdate(body.ids);
    }
  );

  app.post("/api/kiosks", { preHandler: requireRoles("admin", "editor") }, async (request, reply) => {
    const body = kioskSchema.parse(request.body);
    await refreshDeployCredentialsFromDb();
    const hostname = resolveKioskHostname(body.hostname);
    if (!hostname) return reply.code(400).send({ error: "hostname required" });

    const typeResolved = await resolveKioskTypeFields({
      kioskType: body.kioskType ?? "exhibit",
      wallTargetKioskId: body.wallTargetKioskId,
      exhibitId: body.exhibitId ?? null,
    });
    if (!typeResolved.ok) return reply.code(400).send({ error: typeResolved.error });

    try {
      const k = await prisma.kiosk.create({
        data: {
          hostname,
          kioskId: hostname,
          name: body.name?.trim() || hostname,
          healthPort: body.healthPort ?? 47821,
          uiPort: body.uiPort ?? 47820,
          serverUrl: body.serverUrl ?? null,
          exhibitId: typeResolved.data.exhibitId !== undefined ? typeResolved.data.exhibitId : body.exhibitId ?? null,
          kioskType: typeResolved.data.kioskType,
          wallTargetKioskId: typeResolved.data.wallTargetKioskId,
          peerToken: typeResolved.data.peerToken,
          installStatus: body.installSoftware ? "queued" : "idle",
          installStage: body.installSoftware ? "queued" : "idle",
          installMessage: body.installSoftware ? "В очереди" : null,
        },
        include: {
          exhibit: { select: { title: true } },
          wallTarget: { select: { hostname: true, name: true } },
        },
      });
      const dto = enrichKioskDto(mapKiosk(k));
      broadcastKioskUpsert(dto);
      void probeKioskById(k.id);
      if (body.installSoftware) {
        void startKioskInstall(k.id);
      }
      return dto;
    } catch {
      return reply.code(409).send({ error: "hostname / kioskId already exists" });
    }
  });

  app.patch(
    "/api/kiosks/:id",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = kioskSchema.partial().parse(request.body);
      const existing = await prisma.kiosk.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "Not found" });

      const data: {
        hostname?: string;
        kioskId?: string;
        name?: string;
        healthPort?: number;
        uiPort?: number;
        serverUrl?: string | null;
        exhibitId?: string | null;
        kioskType?: "exhibit" | "veteran_search" | "memory_wall";
        wallTargetKioskId?: string | null;
        peerToken?: string | null;
      } = {};
      if (body.hostname) {
        await refreshDeployCredentialsFromDb();
        const hostname = resolveKioskHostname(body.hostname);
        data.hostname = hostname;
        data.kioskId = hostname;
      }
      if (body.name !== undefined) data.name = body.name;
      if (body.healthPort !== undefined) data.healthPort = body.healthPort;
      if (body.uiPort !== undefined) data.uiPort = body.uiPort;
      if (body.serverUrl !== undefined) {
        const v = body.serverUrl?.trim().replace(/\/$/, "");
        data.serverUrl = v || null;
      }

      const typeTouched =
        body.kioskType !== undefined ||
        body.wallTargetKioskId !== undefined ||
        body.exhibitId !== undefined;
      if (typeTouched) {
        const typeResolved = await resolveKioskTypeFields({
          id,
          kioskType: body.kioskType ?? existing.kioskType,
          wallTargetKioskId:
            body.wallTargetKioskId !== undefined
              ? body.wallTargetKioskId
              : existing.wallTargetKioskId,
          exhibitId: body.exhibitId !== undefined ? body.exhibitId : existing.exhibitId,
        });
        if (!typeResolved.ok) return reply.code(400).send({ error: typeResolved.error });
        data.kioskType = typeResolved.data.kioskType;
        data.wallTargetKioskId = typeResolved.data.wallTargetKioskId;
        data.peerToken = typeResolved.data.peerToken;
        if (typeResolved.data.exhibitId !== undefined) {
          data.exhibitId = typeResolved.data.exhibitId;
        } else if (body.exhibitId !== undefined && typeResolved.data.kioskType === "exhibit") {
          data.exhibitId = body.exhibitId;
        }
      }

      try {
        const k = await prisma.kiosk.update({
          where: { id },
          data,
          include: {
            exhibit: { select: { title: true } },
            wallTarget: { select: { hostname: true, name: true } },
          },
        });
        const dto = enrichKioskDto(mapKiosk(k));
        broadcastKioskUpsert(dto);
        if (body.exhibitId !== undefined) {
          broadcastContentSync({ reason: "kiosk-exhibit", exhibitId: body.exhibitId });
        }
        if (body.hostname || body.healthPort || body.uiPort) void probeKioskById(id);
        return dto;
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    }
  );

  app.post(
    "/api/kiosks/:id/probe",
    { preHandler: requireRoles("admin", "editor", "viewer") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const dto = await probeKioskById(id);
      if (!dto) return reply.code(404).send({ error: "Not found" });
      return dto;
    }
  );

  app.post(
    "/api/kiosks/:id/install",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.kiosk.findUnique({
        where: { id },
        include: { exhibit: { select: { title: true } } },
      });
      if (!existing) return reply.code(404).send({ error: "Not found" });

      clearInstallCancelRequest(id);

      const queued = await prisma.kiosk.update({
        where: { id },
        data: {
          installStatus: "queued",
          installStage: "queued",
          installMessage: "В очереди",
          lastInstallAt: new Date(),
        },
        include: { exhibit: { select: { title: true } } },
      });
      const dto = enrichKioskDto(mapKiosk(queued));
      broadcastKioskUpsert(dto);
      void startKioskInstall(id);
      return dto;
    }
  );

  app.post(
    "/api/kiosks/:id/install/cancel",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const dto = await cancelKioskInstall(id);
      if (!dto) return reply.code(404).send({ error: "Not found" });
      return dto;
    }
  );

  app.post(
    "/api/kiosks/:id/start",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await requestStartKioskRuntime(id);
      if (!result.kiosk && /не найден|not found/i.test(result.message)) {
        return reply.code(404).send({ error: result.message });
      }
      if (!result.ok) {
        return reply.code(400).send({ error: result.message, kiosk: result.kiosk });
      }
      return {
        ok: true,
        alreadyRunning: result.alreadyRunning,
        message: result.message,
        kiosk: result.kiosk,
      };
    }
  );

  app.post(
    "/api/kiosks/:id/software-update",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await requestKioskSoftwareUpdate(id);
      if (!result.kiosk && /не найден|not found/i.test(result.message)) {
        return reply.code(404).send({ error: result.message });
      }
      if (result.mode === "no-package") {
        return reply.code(409).send({ ...result, error: result.message });
      }
      return result;
    }
  );

  app.post(
    "/api/kiosks/:id/install-game",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as { folder?: string; exe?: string };
      const result = await requestKioskGameInstall(id, body);
      if (!result.ok) {
        return reply.code(result.status).send({
          error: result.message,
          message: result.message,
          kiosk: result.kiosk,
        });
      }
      return reply.code(202).send({
        ok: true,
        message: result.message,
        kiosk: result.kiosk,
      });
    }
  );

  app.post(
    "/api/kiosks/:id/uninstall-game",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as { folder?: string };
      const result = await requestKioskGameUninstall(id, body);
      if (!result.ok) {
        return reply.code(result.status).send({
          error: result.message,
          message: result.message,
          kiosk: result.kiosk,
        });
      }
      return {
        ok: true,
        message: result.message,
        kiosk: result.kiosk,
      };
    }
  );

  app.post(
    "/api/kiosks/:id/stop",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await requestStopKioskRuntime(id);
      if (!result.kiosk && result.message === "Not found") {
        return reply.code(404).send({ error: "Not found" });
      }
      if (!result.ok) {
        return reply.code(400).send({ error: result.message, kiosk: result.kiosk });
      }
      return {
        ok: true,
        alreadyRunning: result.alreadyRunning,
        message: result.message,
        kiosk: result.kiosk,
      };
    }
  );

  app.post(
    "/api/kiosks/:id/clear-policies",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await requestClearKioskPolicies(id);
      if (!result.kiosk && result.message === "Not found") {
        return reply.code(404).send({ error: "Not found" });
      }
      if (!result.ok) {
        return reply.code(400).send({ error: result.message, kiosk: result.kiosk });
      }
      return {
        ok: true,
        alreadyRunning: result.alreadyRunning,
        message: result.message,
        kiosk: result.kiosk,
      };
    }
  );

  app.post(
    "/api/kiosks/:id/push-config",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await pushKioskConfig(id);
      if (!result.kiosk && result.message === "Not found") {
        return reply.code(404).send({ error: "Not found" });
      }
      if (!result.ok) {
        return reply.code(400).send({ error: result.message, kiosk: result.kiosk });
      }
      return { ok: true, message: result.message, kiosk: result.kiosk };
    }
  );

  app.delete(
    "/api/kiosks/:id",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const q = request.query as { purge?: string };
      const purge = q.purge !== "0" && q.purge !== "false";

      const existing = await prisma.kiosk.findUnique({
        where: { id },
        include: { exhibit: { select: { title: true } } },
      });
      if (!existing) return reply.code(404).send({ error: "Not found" });

      const prep = await prepareKioskDeletion(id);
      if (!prep.ok) {
        return reply.code(409).send({ error: prep.message });
      }

      let uninstallMessage: string | null = null;
      if (purge) {
        const un = await uninstallKioskRuntime(id);
        uninstallMessage = un.message;
        if (!un.ok) {
          return reply.code(400).send({
            error: un.message,
            hint: "Софт с ПК не снят. Повторите или удалите только из админки: DELETE ?purge=0",
          });
        }
      }

      try {
        await prisma.kiosk.delete({ where: { id } });
        broadcastKioskRemoved(id);
        return {
          ok: true,
          purged: purge,
          message: purge
            ? uninstallMessage || "Киоск удалён из админки, софт снят с ПК"
            : "Киоск удалён только из админки",
        };
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    }
  );

  app.get("/api/kiosks/:kioskId/manifest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { kioskId } = request.params as { kioskId: string };
    const kiosk = await prisma.kiosk.findFirst({
      where: kioskHostWhere(kioskId),
      include: { exhibit: { include: exhibitMediaInclude } },
    });

    if (!kiosk) return reply.code(404).send({ error: "Kiosk not found" });

    return buildKioskManifest({
      kioskId: kiosk.kioskId,
      hostname: kiosk.hostname,
      exhibit: kiosk.exhibit,
    });
  });

  app.get("/api/deploy/meta", async () => {
    const meta = getDeployMeta();
    return {
      softwareVersion: meta.softwareVersion,
      appVersion: meta.appVersion,
      builtAt: meta.builtAt,
      hasUpdateZip: Boolean(meta.updateZipPath),
      hasPackageZip: Boolean(meta.packageZipPath),
      updateUrl: "/api/deploy/update.zip",
      packageUrl: "/api/deploy/package.zip",
      serverTime: new Date().toISOString(),
    };
  });

  app.get("/api/deploy/update.zip", async (_request, reply) => {
    const meta = getDeployMeta();
    const file = meta.updateZipPath || meta.packageZipPath;
    if (!file || !existsSync(file)) {
      return reply.code(404).send({ error: "Update package not found. Run pnpm pack:kiosk-deploy." });
    }
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", 'attachment; filename="stella-kiosk-update.zip"');
    reply.header("X-Software-Version", meta.softwareVersion);
    return reply.send(createReadStream(file));
  });

  app.get("/api/deploy/package.zip", async (_request, reply) => {
    const meta = getDeployMeta();
    if (!meta.packageZipPath || !existsSync(meta.packageZipPath)) {
      return reply.code(404).send({ error: "Deploy package not found. Run pnpm pack:kiosk-deploy." });
    }
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", 'attachment; filename="stella-kiosk-package.zip"');
    reply.header("X-Software-Version", meta.softwareVersion);
    return reply.send(createReadStream(meta.packageZipPath));
  });

  /** Live push: admin content changes → kiosk UI syncs immediately (no JWT). */
  app.get("/api/kiosks/:kioskId/events", async (request, reply) => {
    const { kioskId } = request.params as { kioskId: string };
    const kiosk = await prisma.kiosk.findFirst({
      where: kioskHostWhere(kioskId),
      select: { kioskId: true },
    });
    if (!kiosk) return reply.code(404).send({ error: "Kiosk not found" });

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });
    reply.raw.write(": ok\n\n");
    addContentClient(kiosk.kioskId, reply.raw);
    sendContentHello(reply.raw);

    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clearInterval(keepAlive);
      }
    }, 25_000);
    reply.raw.on("close", () => clearInterval(keepAlive));
  });

  app.get("/api/kiosks/:kioskId/updates", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { kioskId } = request.params as { kioskId: string };
    const kiosk = await prisma.kiosk.findFirst({
      where: kioskHostWhere(kioskId),
      include: { exhibit: { select: { contentVersion: true } } },
    });
    if (!kiosk) return reply.code(404).send({ error: "Kiosk not found" });

    const meta = getDeployMeta();
    const q = request.query as { softwareVersion?: string };
    const localSw = String(q.softwareVersion || "").trim();
    const hasZip = Boolean(meta.updateZipPath || meta.packageZipPath);
    const updateAvailable = Boolean(
      localSw && meta.softwareVersion && localSw !== meta.softwareVersion && hasZip
    );
    // Versions only — avoid loading full ads/timeline media graphs on every poll
    const settings = await ensureSiteSettings();
    const contentVersion = kiosk.exhibit?.contentVersion ?? null;
    const adsVersion = settings.adsVersion;
    const settingsVersion = settings.settingsVersion;
    const timelineVersion = settings.timelineVersion || "1";
    const themeMode = parseThemeMode(settings.themeMode);
    const themeDarkFrom = normalizeHhMm(settings.themeDarkFrom, "20:00");
    const themeDarkTo = normalizeHhMm(settings.themeDarkTo, "08:00");

    const pending = getSoftwareUpdatePending(kiosk.kioskId);
    const forceUpdate = Boolean(
      pending && meta.softwareVersion && pending.target === meta.softwareVersion && hasZip
    );
    if (localSw) acknowledgeSoftwareVersion(kiosk.kioskId, localSw);

    return {
      kioskId: kiosk.kioskId,
      contentVersion,
      adsVersion,
      timelineVersion,
      settingsVersion,
      blockKeyboard: settings.blockKeyboard,
      softwareEnabled: settings.softwareEnabled,
      themeMode,
      themeDarkFrom,
      themeDarkTo,
      theme: resolveEffectiveTheme({
        mode: themeMode,
        darkFrom: themeDarkFrom,
        darkTo: themeDarkTo,
      }),
      syncFingerprint: syncFingerprint(contentVersion, adsVersion, settingsVersion, timelineVersion),
      softwareVersion: meta.softwareVersion,
      appVersion: meta.appVersion,
      updateAvailable: forceUpdate || (localSw ? updateAvailable : hasZip),
      forceUpdate,
      packageUrl: "/api/deploy/update.zip",
      serverTime: new Date().toISOString(),
    };
  });

  app.post("/api/kiosks/:kioskId/heartbeat", async (request, reply) => {
    const { kioskId } = request.params as { kioskId: string };
    const body = heartbeatSchema.parse(request.body ?? {});
    try {
      const existing = await prisma.kiosk.findFirst({
        where: kioskHostWhere(kioskId),
      });
      if (!existing) return reply.code(404).send({ error: "Kiosk not found" });

      const k = await prisma.kiosk.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(),
          contentVersion: body.contentVersion === undefined ? undefined : body.contentVersion,
          syncStatus: body.syncStatus,
          syncMessage: body.syncMessage === undefined ? undefined : body.syncMessage,
          appVersion: body.appVersion === undefined ? undefined : body.appVersion,
          softwareVersion: body.softwareVersion === undefined ? undefined : body.softwareVersion,
          hostname: body.hostname ? resolveKioskHostname(body.hostname) : undefined,
        },
        include: { exhibit: { select: { title: true, contentVersion: true } } },
      });
      if (body.gameCopy) {
        setGameCopyState(k.kioskId, k.hostname, {
          status: body.gameCopy.status,
          folder: body.gameCopy.folder ?? null,
          percent: body.gameCopy.percent ?? null,
          copiedBytes: body.gameCopy.copiedBytes ?? null,
          totalBytes: body.gameCopy.totalBytes ?? null,
          message: body.gameCopy.message ?? null,
          updatedAt: body.gameCopy.updatedAt ?? new Date().toISOString(),
        });
      }
      if (body.installedGames) {
        setInstalledGames(k.kioskId, k.hostname, body.installedGames);
      }
      const dto = enrichKioskDto(mapKiosk(k));
      broadcastKioskUpsert(dto);

      const meta = getDeployMeta();
      const settings = await ensureSiteSettings();
      if (body.gameShare) {
        await prisma.siteSettings.update({
          where: { id: "default" },
          data: {
            gameShareFolders: body.gameShare.folders as Prisma.InputJsonValue,
            gameShareScannedAt: new Date(),
            gameShareSource: k.hostname,
          },
        });
      }
      const contentVersion = k.exhibit?.contentVersion ?? null;
      const adsVersion = settings.adsVersion;
      const settingsVersion = settings.settingsVersion;
      const timelineVersion = settings.timelineVersion || "1";
      const hasZip = Boolean(meta.updateZipPath || meta.packageZipPath);
      const pending = getSoftwareUpdatePending(k.kioskId) || getSoftwareUpdatePending(k.hostname);
      const forceUpdate = Boolean(
        pending && meta.softwareVersion && pending.target === meta.softwareVersion && hasZip
      );
      const updateAvailable = Boolean(
        forceUpdate ||
          (body.softwareVersion &&
            meta.softwareVersion &&
            body.softwareVersion !== meta.softwareVersion &&
            hasZip)
      );

      // Acknowledge only after force flag was exposed (grace inside helper)
      if (body.softwareVersion) acknowledgeSoftwareVersion(k.kioskId, body.softwareVersion);

      return {
        ...dto,
        contentVersion,
        adsVersion,
        settingsVersion,
        timelineVersion,
        syncFingerprint: syncFingerprint(contentVersion, adsVersion, settingsVersion, timelineVersion),
        targetSoftwareVersion: meta.softwareVersion,
        updateAvailable,
        forceUpdate,
        gameShareUnc: settings.gameShareUnc,
      };
    } catch {
      return reply.code(404).send({ error: "Kiosk not found" });
    }
  });
}
