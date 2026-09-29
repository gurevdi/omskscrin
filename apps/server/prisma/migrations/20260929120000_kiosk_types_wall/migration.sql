-- CreateEnum
CREATE TYPE "KioskType" AS ENUM ('exhibit', 'veteran_search', 'memory_wall');

-- AlterTable
ALTER TABLE "Kiosk" ADD COLUMN "kioskType" "KioskType" NOT NULL DEFAULT 'exhibit';
ALTER TABLE "Kiosk" ADD COLUMN "wallTargetKioskId" TEXT;
ALTER TABLE "Kiosk" ADD COLUMN "peerToken" TEXT;

-- AddForeignKey
ALTER TABLE "Kiosk" ADD CONSTRAINT "Kiosk_wallTargetKioskId_fkey" FOREIGN KEY ("wallTargetKioskId") REFERENCES "Kiosk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
