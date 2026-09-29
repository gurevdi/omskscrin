import type { ThemeMode as ThemeModeT, ThemeName as ThemeNameT } from "./theme.js";
export type ThemeMode = ThemeModeT;
export type ThemeName = ThemeNameT;
export {
  isDarkBySchedule,
  normalizeHhMm,
  parseThemeMode,
  resolveEffectiveTheme,
} from "./theme.js";

export const ROLES = ["admin", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type SyncStatus = "ok" | "error" | "unknown";
export type ProbeStatus =
  | "unknown"
  | "healthy"
  | "degraded"
  | "no_software"
  | "unreachable";

export type InstallStatus = "idle" | "queued" | "running" | "ok" | "error";

/** Kiosk product mode — exhibit tech, veteran search, or memory wall display */
export type KioskType = "exhibit" | "veteran_search" | "memory_wall";

export const KIOSK_TYPE_LABEL: Record<KioskType, string> = {
  exhibit: "Экспонат",
  veteran_search: "Поиск ветерана",
  memory_wall: "Стена памяти",
};

export const WALL_SHOW_TTL_SEC = 15 * 60;

/** Peer payload: search agent → wall agent */
export interface WallVeteranPayload {
  sourceUrl: string;
  fullName?: string | null;
  birthYear?: string | null;
  deathYear?: string | null;
  rank?: string | null;
  summary?: string | null;
  photoUrl?: string | null;
}

export interface WallShowRequest {
  sourceHostname: string;
  shownAt: string;
  ttlSec: number;
  veteran: WallVeteranPayload;
}

export interface WallStateDto {
  status: "idle" | "showing";
  veteran: WallVeteranPayload | null;
  sourceHostname: string | null;
  shownAt: string | null;
  expiresAt: string | null;
  ttlSec: number;
}

/** wallPeer block inside kiosk.json on search / wall machines */
export interface KioskWallPeerConfig {
  hostname: string;
  healthPort: number;
  token: string;
}

export type InstallStage =
  | "idle"
  | "queued"
  | "connecting"
  | "copying"
  | "configuring"
  | "installing"
  | "starting"
  | "done"
  | "error";

export const PROBE_STATUS_LABEL: Record<ProbeStatus, string> = {
  unknown: "не проверен",
  healthy: "в норме",
  degraded: "частично",
  no_software: "нет софта",
  unreachable: "недоступен",
};

export const INSTALL_STATUS_LABEL: Record<InstallStatus, string> = {
  idle: "не ставился",
  queued: "в очереди",
  running: "устанавливается",
  ok: "установлен",
  error: "ошибка установки",
};

/** Ordered pipeline steps shown in admin during install */
export const INSTALL_STAGE_STEPS: { id: InstallStage; label: string }[] = [
  { id: "queued", label: "В очереди" },
  { id: "connecting", label: "Подключение" },
  { id: "copying", label: "Копирование" },
  { id: "configuring", label: "Конфиг" },
  { id: "installing", label: "Службы" },
  { id: "starting", label: "Запуск" },
  { id: "done", label: "Готово" },
];

export const INSTALL_STAGE_LABEL: Record<InstallStage, string> = {
  idle: "—",
  queued: "В очереди",
  connecting: "Подключение по WinRM",
  copying: "Копирование файлов",
  configuring: "Запись kiosk.json",
  installing: "Настройка задач Windows",
  starting: "Запуск агента и UI",
  done: "Установка завершена",
  error: "Ошибка",
};

export type PolicyClearStatus = "idle" | "running" | "ok" | "error";

export type PolicyClearStage = "idle" | "connecting" | "clearing" | "done" | "error";

export const POLICY_CLEAR_STATUS_LABEL: Record<PolicyClearStatus, string> = {
  idle: "—",
  running: "снятие политик",
  ok: "политики сняты",
  error: "ошибка",
};

export const POLICY_CLEAR_STAGE_STEPS: { id: PolicyClearStage; label: string }[] = [
  { id: "connecting", label: "Подключение" },
  { id: "clearing", label: "Снятие политик" },
  { id: "done", label: "Готово" },
];

export const POLICY_CLEAR_STAGE_LABEL: Record<PolicyClearStage, string> = {
  idle: "—",
  connecting: "Подключение к Windows-ПК",
  clearing: "Снятие политик lockdown",
  done: "Политики сняты",
  error: "Ошибка",
};

export type UiStartStatus = "idle" | "running" | "ok" | "error";

export type UiStartStage = "idle" | "connecting" | "starting" | "done" | "error";

export const UI_START_STATUS_LABEL: Record<UiStartStatus, string> = {
  idle: "—",
  running: "запуск UI",
  ok: "UI запущен",
  error: "ошибка",
};

export const UI_START_STAGE_STEPS: { id: UiStartStage; label: string }[] = [
  { id: "connecting", label: "Подключение" },
  { id: "starting", label: "Агент и Edge" },
  { id: "done", label: "Готово" },
];

export const UI_START_STAGE_LABEL: Record<UiStartStage, string> = {
  idle: "—",
  connecting: "Подключение к Windows-ПК",
  starting: "Запуск агента и Edge UI",
  done: "Киоск запущен",
  error: "Ошибка",
};

export type UiStopStatus = "idle" | "running" | "ok" | "error";

export type UiStopStage = "idle" | "connecting" | "stopping" | "done" | "error";

export const UI_STOP_STATUS_LABEL: Record<UiStopStatus, string> = {
  idle: "—",
  running: "остановка",
  ok: "UI остановлен",
  error: "ошибка",
};

export const UI_STOP_STAGE_STEPS: { id: UiStopStage; label: string }[] = [
  { id: "connecting", label: "Подключение" },
  { id: "stopping", label: "Агент и Edge" },
  { id: "done", label: "Готово" },
];

export const UI_STOP_STAGE_LABEL: Record<UiStopStage, string> = {
  idle: "—",
  connecting: "Подключение к Windows-ПК",
  stopping: "Остановка агента и Edge UI",
  done: "Софт на киоске выключен",
  error: "Ошибка",
};

export interface LoginRequest {
  login: string;
  password: string;
}

export interface AuthUser {
  id: string;
  login: string;
  role: Role;
  active: boolean;
  superAdmin: boolean;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface SpecRow {
  label: string;
  value: string;
}

/** Разбор текста в строки таблицы: одна строка = один параметр. */
export function parseSpecsText(text: string): SpecRow[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows: SpecRow[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.includes("\t")) {
      const [label, ...rest] = line.split("\t");
      rows.push({ label: label.trim(), value: rest.join("\t").trim() });
      continue;
    }

    const match = line.match(/^(.+?)\s*(?:—|–|:|：|\||-)\s+(.+)$/);
    if (match) {
      rows.push({ label: match[1].trim(), value: match[2].trim() });
      continue;
    }

    rows.push({ label: line, value: "" });
  }

  return rows;
}

export function formatSpecsText(specs: SpecRow[]): string {
  return specs
    .filter((r) => r.label.trim() || r.value.trim())
    .map((r) => (r.value.trim() ? `${r.label.trim()} — ${r.value.trim()}` : r.label.trim()))
    .join("\n");
}

export interface ExhibitGame {
  title: string;
  shareFolder: string;
  exe: string;
}

/** Kiosk play button — game is pre-installed at C:\\PatriotGame (no UNC copy). */
export function exhibitGameFromRow(e: {
  gameTitle?: string | null;
  gameShareFolder?: string | null;
  gameExe?: string | null;
}): ExhibitGame | null {
  const title = String(e.gameTitle || "").trim();
  if (!title) return null;
  return {
    title,
    shareFolder: "PatriotGame",
    exe: DEFAULT_PATRIOT_GAME_EXE,
  };
}

export interface GameShareFolder {
  name: string;
  exes: string[];
}

export interface GameShareDto {
  unc: string;
  folders: GameShareFolder[];
  scannedAt: string | null;
  sourceHostname: string | null;
}

export type GameCopyStatus = "idle" | "copying" | "launching" | "running" | "error";

export interface GameCopyDto {
  status: GameCopyStatus;
  folder: string | null;
  percent: number | null;
  copiedBytes: number | null;
  totalBytes: number | null;
  message: string | null;
  updatedAt: string | null;
}

export const GAME_COPY_STATUS_LABEL: Record<GameCopyStatus, string> = {
  idle: "C:\\PatriotGame готова",
  copying: "Проверка игры…",
  launching: "Запуск game.exe…",
  running: "Игра запущена",
  error: "Ошибка игры",
};

export const GAME_COPY_STATUS_STEPS: { id: GameCopyStatus; label: string }[] = [
  { id: "launching", label: "Запуск" },
  { id: "running", label: "Работает" },
];

/** Kiosk reports PatriotGame folder present under C:\\PatriotGame. */
export function isPatriotGameOnKiosk(installedGames?: string[] | null): boolean {
  return Boolean(
    installedGames?.some((name) => String(name).toLowerCase() === "patriotgame")
  );
}

export const DEFAULT_GAME_SHARE_UNC = "\\\\HYDRALISK3\\Patriot\\Игры парк победы";

/** Fixed local path where the kiosk agent installs and launches Patriot UE games. */
export const KIOSK_PATRIOT_GAME_ROOT = "C:\\PatriotGame";

/** Launcher written to window.txt=1 before start (Stelarium watchdog). */
export const DEFAULT_PATRIOT_GAME_EXE = "game.exe";

/** Normalize Windows/UNC path separators and trailing slashes. */
export function normalizeUncPath(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/[\\\/]+$/, "");
}

/**
 * Relative folder on the game share, or parse a pasted full UNC without doubling the root.
 */
export function normalizeGameShareFolder(
  uncRoot: string | null | undefined,
  folderOrPath: string | null | undefined
): string {
  const root = normalizeUncPath(uncRoot) || DEFAULT_GAME_SHARE_UNC;
  let folder = String(folderOrPath || "").trim().replace(/\//g, "\\");
  if (!folder) return "";

  if (folder.startsWith("\\\\")) {
    folder = normalizeUncPath(folder);
    const rootL = root.toLowerCase();
    const folderL = folder.toLowerCase();
    if (folderL === rootL) return "";
    if (folderL.startsWith(rootL + "\\")) {
      return folder.slice(root.length).replace(/^[\\\/]+/, "");
    }
    return folder.split("\\").filter(Boolean).pop() || "";
  }

  const rootBare = root.replace(/^\\+/, "");
  const folderL = folder.toLowerCase();
  if (folderL.startsWith(root.toLowerCase() + "\\")) {
    folder = folder.slice(root.length).replace(/^[\\\/]+/, "");
  } else if (folderL.startsWith(rootBare.toLowerCase() + "\\")) {
    folder = folder.slice(rootBare.length).replace(/^[\\\/]+/, "");
  }

  return folder.replace(/^[\\\/]+/, "").replace(/[\\\/]+$/, "");
}

export function joinGameShareUnc(
  uncRoot: string | null | undefined,
  folderOrPath: string | null | undefined
): string {
  const root = normalizeUncPath(uncRoot) || DEFAULT_GAME_SHARE_UNC;
  const folder = normalizeGameShareFolder(root, folderOrPath);
  if (!folder) return root;
  return `${root}\\${folder}`;
}

export interface ExhibitDto {
  id: string;
  title: string;
  summary: string;
  body: string;
  specs: SpecRow[];
  heroImageId: string | null;
  galleryIds: string[];
  videoId: string | null;
  audioId: string | null;
  contentVersion: string;
  updatedAt: string;
  gameTitle: string;
  gameShareFolder: string;
  gameExe: string;
}

export interface FileDto {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface KioskDto {
  id: string;
  kioskId: string;
  hostname: string;
  name: string;
  healthPort: number;
  uiPort: number;
  serverUrl: string | null;
  exhibitId: string | null;
  exhibitTitle?: string | null;
  kioskType: KioskType;
  wallTargetKioskId: string | null;
  wallTargetHostname?: string | null;
  wallTargetName?: string | null;
  /** True when peerToken is set (token itself never sent to browser) */
  peerTokenSet: boolean;
  lastSeenAt: string | null;
  online: boolean;
  contentVersion: string | null;
  syncStatus: SyncStatus;
  syncMessage: string | null;
  appVersion: string | null;
  softwareVersion: string | null;
  /** Server package version the fleet should be on (from deploy/current). */
  otaTarget?: string | null;
  /** Admin forced OTA; waiting for agent to report matching softwareVersion. */
  otaPending?: boolean;
  probeStatus: ProbeStatus;
  probeMessage: string | null;
  lastProbeAt: string | null;
  installStatus: InstallStatus;
  installStage: InstallStage;
  installMessage: string | null;
  lastInstallAt: string | null;
  policyClearStatus: PolicyClearStatus;
  policyClearStage: PolicyClearStage;
  policyClearMessage: string | null;
  uiStartStatus: UiStartStatus;
  uiStartStage: UiStartStage;
  uiStartMessage: string | null;
  uiStopStatus: UiStopStatus;
  uiStopStage: UiStopStage;
  uiStopMessage: string | null;
  /** Live game launch / verify on kiosk (C:\\PatriotGame). */
  gameCopy?: GameCopyDto | null;
  /** Local Patriot game install present (C:\\PatriotGame). */
  installedGames?: string[] | null;
  /** Bound exhibit game config (for admin install button). */
  exhibitGame?: {
    title: string;
    shareFolder: string;
    exe: string;
  } | null;
}

export interface HeartbeatRequest {
  contentVersion?: string | null;
  syncStatus?: SyncStatus;
  syncMessage?: string | null;
  appVersion?: string | null;
  softwareVersion?: string | null;
  hostname?: string;
  gameShare?: {
    folders: GameShareFolder[];
  };
  gameCopy?: GameCopyDto;
  installedGames?: string[];
}

export interface ManifestFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  hash: string;
  url: string;
}

export interface KioskManifest {
  kioskId: string;
  hostname?: string;
  exhibit: {
    id: string;
    title: string;
    summary: string;
    body: string;
    specs: SpecRow[];
    heroImageId: string | null;
    galleryIds: string[];
    videoId: string | null;
    audioId: string | null;
    contentVersion: string;
    updatedAt: string;
    game: ExhibitGame | null;
  } | null;
  /** Global ads for all kiosks */
  adIds: string[];
  adsVersion: string;
  /** Shared timeline year pages (1941…) for all kiosks */
  timelinePages: TimelinePageManifest[];
  timelineVersion: string;
  /** Visitor keyboard blocked on kiosk UI */
  blockKeyboard: boolean;
  /** When false, kiosk software stays fully off (persists across reboot) */
  softwareEnabled: boolean;
  themeMode: ThemeMode;
  themeDarkFrom: string;
  themeDarkTo: string;
  theme: ThemeName | null;
  settingsVersion: string;
  files: ManifestFile[];
  contentVersion: string | null;
  serverTime: string;
}

/** Lightweight poll: content + software versions without full manifest/media */
export interface KioskUpdates {
  kioskId: string;
  contentVersion: string | null;
  adsVersion: string;
  timelineVersion: string;
  settingsVersion: string;
  blockKeyboard: boolean;
  softwareEnabled: boolean;
  /** Combined fingerprint: contentVersion|adsVersion|settingsVersion|timelineVersion */
  syncFingerprint: string;
  softwareVersion: string;
  appVersion: string;
  updateAvailable: boolean;
  packageUrl: string;
  serverTime: string;
  /** Fleet theme control */
  themeMode: ThemeMode;
  themeDarkFrom: string;
  themeDarkTo: string;
  /** Resolved now (null when themeMode=manual) */
  theme: ThemeName | null;
}

export interface SiteNetworkDto {
  serverPublicUrl: string;
  effectiveServerPublicUrl: string;
  defaultHealthPort: number;
  defaultUiPort: number;
  corsOrigins: string;
  effectiveCorsOrigins: string[];
  probeIntervalMs: number;
  probeTimeoutMs: number;
}

export interface SiteSettingsDto {
  blockKeyboard: boolean;
  softwareEnabled: boolean;
  themeMode: ThemeMode;
  themeDarkFrom: string;
  themeDarkTo: string;
  /** Current effective theme when not manual */
  theme: ThemeName | null;
  /** UNC root for exhibit games (scanned by domain kiosks). */
  gameShareUnc: string;
  settingsVersion: string;
  adsVersion: string;
  updatedAt: string;
  network: SiteNetworkDto;
}

/** Domain deploy account for WinRM from Debian → Windows kiosks */
export interface DeploySettingsDto {
  deployUser: string;
  deployPasswordSet: boolean;
  domainSuffix: string;
  deployTransport: "auto" | "ssh" | "winrm";
  sshKeyConfigured: boolean;
  credentialsOk: boolean;
  source: "db" | "env" | "mixed";
}

export interface AdsDto {
  adIds: string[];
  ads: FileDto[];
  adsVersion: string;
  updatedAt: string;
}

/** One shared timeline page (year) with up to 8 ordered images */
export interface TimelinePageDto {
  id: string;
  label: string;
  sortOrder: number;
  imageIds: string[];
  images: FileDto[];
}

export interface TimelinePageManifest {
  id: string;
  label: string;
  sortOrder: number;
  imageIds: string[];
}

export interface TimelineDto {
  pages: TimelinePageDto[];
  timelineVersion: string;
  updatedAt: string;
}

/** Soft upper bound per timeline page (safety against accidental huge uploads) */
export const TIMELINE_MAX_IMAGES = 100;

export const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;
