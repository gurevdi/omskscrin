import { prisma } from "./prisma.js";
import { buildKioskJsonConfig, getSiteNetworkSettings } from "./networkSettings.js";
import { ensureSiteSettings } from "./siteSettings.js";

/** Full kiosk.json payload including kioskType / wallPeer / peerToken. */
export async function buildFullKioskJsonConfig(kioskId: string) {
  const kiosk = await prisma.kiosk.findUnique({
    where: { id: kioskId },
    include: {
      wallTarget: { select: { hostname: true, healthPort: true } },
    },
  });
  if (!kiosk) return null;

  const site = await getSiteNetworkSettings();
  const settings = await ensureSiteSettings();
  const wallPeer =
    kiosk.kioskType === "veteran_search" && kiosk.wallTarget && kiosk.peerToken
      ? {
          hostname: kiosk.wallTarget.hostname.toLowerCase(),
          healthPort: kiosk.wallTarget.healthPort || 47821,
          token: kiosk.peerToken,
        }
      : null;

  return buildKioskJsonConfig({ ...kiosk, wallPeer }, site, settings.gameShareUnc);
}
