import { randomBytes } from "node:crypto";
import type { KioskType } from "@prisma/client";
import { prisma } from "./prisma.js";

export function newPeerToken() {
  return randomBytes(24).toString("hex");
}

export function isKioskType(v: unknown): v is KioskType {
  return v === "exhibit" || v === "veteran_search" || v === "memory_wall";
}

export type KioskTypePatch = {
  kioskType: KioskType;
  wallTargetKioskId: string | null;
  exhibitId?: string | null;
  peerToken: string | null;
};

/**
 * Resolve type / exhibit / wall-pair fields for create|update.
 * Search and wall share the wall's peerToken.
 */
export async function resolveKioskTypeFields(opts: {
  id?: string;
  kioskType: KioskType;
  wallTargetKioskId?: string | null;
  exhibitId?: string | null;
}): Promise<{ ok: true; data: KioskTypePatch } | { ok: false; error: string }> {
  const type = opts.kioskType;

  if (type === "exhibit") {
    return {
      ok: true,
      data: {
        kioskType: "exhibit",
        wallTargetKioskId: null,
        peerToken: null,
        exhibitId: opts.exhibitId !== undefined ? opts.exhibitId : undefined,
      },
    };
  }

  if (type === "memory_wall") {
    let token: string | null = null;
    if (opts.id) {
      const cur = await prisma.kiosk.findUnique({
        where: { id: opts.id },
        select: { peerToken: true },
      });
      token = cur?.peerToken ?? null;
    }
    return {
      ok: true,
      data: {
        kioskType: "memory_wall",
        wallTargetKioskId: null,
        exhibitId: null,
        peerToken: token || newPeerToken(),
      },
    };
  }

  // veteran_search
  const wallId = opts.wallTargetKioskId ?? null;
  if (!wallId) {
    return {
      ok: true,
      data: {
        kioskType: "veteran_search",
        wallTargetKioskId: null,
        exhibitId: null,
        peerToken: null,
      },
    };
  }

  if (opts.id && wallId === opts.id) {
    return { ok: false, error: "Стена не может быть этим же киоском" };
  }

  const target = await prisma.kiosk.findUnique({
    where: { id: wallId },
    select: { id: true, kioskType: true, peerToken: true },
  });
  if (!target) return { ok: false, error: "Целевая стена не найдена" };
  if (target.kioskType !== "memory_wall") {
    return { ok: false, error: "Целевой киоск должен быть типа «Стена памяти»" };
  }

  let token = target.peerToken;
  if (!token) {
    token = newPeerToken();
    await prisma.kiosk.update({ where: { id: target.id }, data: { peerToken: token } });
  }

  return {
    ok: true,
    data: {
      kioskType: "veteran_search",
      wallTargetKioskId: wallId,
      exhibitId: null,
      peerToken: token,
    },
  };
}
