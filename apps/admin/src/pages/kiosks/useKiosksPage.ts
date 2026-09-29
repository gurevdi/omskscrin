import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { KioskDto, KioskType } from "@stella/shared";
import { useAuth } from "../../auth";
import { api } from "../../api";
import type { DeployStatus } from "../../components/kiosk/DeployStatusPanel";
import type { FleetJob, KioskOpRunnerState } from "../../components/kiosk/KioskOpRunner";
import { kioskHasProblem } from "../../components/kiosk/status";
import { useConfirm } from "../../components/ui/confirm";
import type { ExhibitOpt, FilterTab } from "./kioskHelpers";

function nextSelectedAfterDelete(removedId: string, list: KioskDto[]) {
  const idx = list.findIndex((k) => k.id === removedId);
  if (idx === -1) return list[0]?.id ?? null;
  return list[idx + 1]?.id ?? list[idx - 1]?.id ?? null;
}

function kioskLabel(k: Pick<KioskDto, "name" | "hostname"> | undefined | null, fallback = "Киоск") {
  if (!k) return fallback;
  if (k.name && k.hostname && k.name !== k.hostname) return `${k.name} · ${k.hostname}`;
  return k.name || k.hostname || fallback;
}

export function useKiosksPage() {
  const { canEdit } = useAuth();
  const confirmDialog = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedId = searchParams.get("id");

  const selectKiosk = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("id", id);
          else next.delete("id");
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const [kiosks, setKiosks] = useState<KioskDto[]>([]);
  const [exhibits, setExhibits] = useState<ExhibitOpt[]>([]);
  const [deploy, setDeploy] = useState<DeployStatus | null>(null);
  const [hostname, setHostname] = useState("");
  const [name, setName] = useState("");
  const [exhibitId, setExhibitId] = useState("");
  const [kioskType, setKioskType] = useState<KioskType>("exhibit");
  const [wallTargetKioskId, setWallTargetKioskId] = useState("");
  const [installSoftware, setInstallSoftware] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [domainSuffix, setDomainSuffix] = useState("udhb.local");
  const [testBusy, setTestBusy] = useState(false);
  const [testHint, setTestHint] = useState("");
  const [error, setError] = useState("");
  const [probing, setProbing] = useState<string | null>(null);
  const [probingAll, setProbingAll] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [okHint, setOkHint] = useState("");
  const [savingNetwork, setSavingNetwork] = useState<string | null>(null);
  const [pushingConfig, setPushingConfig] = useState<string | null>(null);
  const [clearingPolicies, setClearingPolicies] = useState<string | null>(null);
  const [updatingSoftware, setUpdatingSoftware] = useState<string | null>(null);
  const [installingGame, setInstallingGame] = useState<string | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [binding, setBinding] = useState<string | null>(null);
  const [removingAdmin, setRemovingAdmin] = useState<string | null>(null);
  const [removingFull, setRemovingFull] = useState<string | null>(null);
  const [probeAllProgress, setProbeAllProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [otaWaiting, setOtaWaiting] = useState<Record<string, string>>({});
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const loadGen = useRef(0);
  const didAutoSelect = useRef(false);

  const patchKiosk = useCallback((dto: KioskDto) => {
    setKiosks((prev) => prev.map((k) => (k.id === dto.id ? { ...k, ...dto } : k)));
  }, []);

  const loadExhibits = useCallback(async () => {
    setExhibits(await api<ExhibitOpt[]>("/api/exhibits?fields=id,title"));
  }, []);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    const [k, d] = await Promise.all([
      api<KioskDto[]>("/api/kiosks"),
      api<DeployStatus>("/api/kiosks/deploy/status"),
    ]);
    if (gen !== loadGen.current) return;

    setKiosks(k);
    setDeploy(d);
    if (d.domainSuffix) setDomainSuffix(d.domainSuffix);

    setOtaWaiting((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, target] of Object.entries(prev)) {
        const row = k.find((x) => x.id === id);
        if (!row || (row.softwareVersion && row.softwareVersion === target)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    const urlId = new URLSearchParams(window.location.search).get("id");
    // Only clear selection if the open kiosk was deleted — never force another id on poll.
    if (urlId && !k.some((x) => x.id === urlId)) {
      selectKiosk(null);
    } else if (!urlId && !didAutoSelect.current && k.length) {
      // First visit without ?id= — open the first row once.
      didAutoSelect.current = true;
      selectKiosk(k[0].id);
    } else {
      didAutoSelect.current = true;
    }
  }, [selectKiosk]);

  useEffect(() => {
    Promise.all([load(), loadExhibits()]).catch((e) =>
      setError(e instanceof Error ? e.message : String(e))
    );
  }, [load, loadExhibits]);

  const installingNow = useMemo(
    () => kiosks.some((k) => k.installStatus === "running" || k.installStatus === "queued"),
    [kiosks]
  );
  const policyClearNow = useMemo(
    () => kiosks.some((k) => k.policyClearStatus === "running"),
    [kiosks]
  );
  const uiStartNow = useMemo(() => kiosks.some((k) => k.uiStartStatus === "running"), [kiosks]);
  const uiStopNow = useMemo(() => kiosks.some((k) => k.uiStopStatus === "running"), [kiosks]);
  const gameCopyNow = useMemo(
    () =>
      kiosks.some((k) => {
        const s = k.gameCopy?.status;
        return s === "copying" || s === "launching" || s === "running";
      }),
    [kiosks]
  );
  const otaWaitingNow = useMemo(
    () => kiosks.some((k) => k.otaPending || otaWaiting[k.id]),
    [kiosks, otaWaiting]
  );

  useEffect(() => {
    const busy =
      installingNow || policyClearNow || uiStartNow || uiStopNow || otaWaitingNow || gameCopyNow;
    const ms = busy ? 2500 : 10000;
    const t = setInterval(() => {
      load().catch(() => undefined);
    }, ms);
    return () => clearInterval(t);
  }, [installingNow, policyClearNow, uiStartNow, uiStopNow, otaWaitingNow, gameCopyNow, load]);

  const stats = useMemo(() => {
    const online = kiosks.filter((k) => k.online).length;
    const healthy = kiosks.filter((k) => k.probeStatus === "healthy").length;
    const installingCount = kiosks.filter(
      (k) => k.installStatus === "running" || k.installStatus === "queued"
    ).length;
    const problems = kiosks.filter((k) => kioskHasProblem(k)).length;
    return { online, healthy, installingCount, problems, total: kiosks.length };
  }, [kiosks]);

  const deployFleet = useMemo(() => {
    const target = deploy?.softwareVersion || null;
    const otaOutdated = kiosks.filter((k) => {
      const local = k.softwareVersion;
      const tgt = k.otaTarget || target;
      return Boolean(tgt && local && local !== tgt);
    }).length;
    const otaPending = kiosks.filter((k) => k.otaPending || otaWaiting[k.id]).length;
    return {
      total: kiosks.length,
      online: kiosks.filter((k) => k.online).length,
      otaOutdated,
      otaPending,
    };
  }, [kiosks, deploy?.softwareVersion, otaWaiting]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return kiosks
      .filter((k) => {
        if (filter === "online") return k.online;
        if (filter === "problems") return kioskHasProblem(k);
        if (filter === "installing")
          return k.installStatus === "running" || k.installStatus === "queued";
        return true;
      })
      .filter((k) => {
        if (!q) return true;
        return k.name.toLowerCase().includes(q) || k.hostname.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [kiosks, filter, search]);

  const selected = useMemo(
    () => (selectedId ? kiosks.find((k) => k.id === selectedId) ?? null : null),
    [kiosks, selectedId]
  );

  const selectedHiddenByFilter = Boolean(
    selected && !filtered.some((k) => k.id === selected.id)
  );

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка обновления");
    } finally {
      setRefreshing(false);
    }
  }

  async function probeAll() {
    if (!kiosks.length) return;
    setProbingAll(true);
    setError("");
    setProbeAllProgress({ current: 0, total: kiosks.length });
    try {
      let i = 0;
      for (const k of kiosks) {
        setProbeAllProgress({ current: i, total: kiosks.length });
        const dto = await api<KioskDto>(`/api/kiosks/${k.id}/probe`, { method: "POST" });
        patchKiosk(dto);
        i += 1;
        setProbeAllProgress({ current: i, total: kiosks.length });
      }
      setOkHint(`Опрос выполнен для ${kiosks.length} киосков`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка опроса");
      await load().catch(() => undefined);
    } finally {
      setProbingAll(false);
      setProbeAllProgress(null);
    }
  }

  async function rollbackAll() {
    setMoreOpen(false);
    if (kiosks.length === 0) {
      const ok = await confirmDialog({
        title: "Сбросить настройки?",
        message: "Будут сброшены флаги «Софт киосков» и «Блокировка клавиатуры».",
        confirmLabel: "Сбросить",
        tone: "warn",
      });
      if (!ok) return;
      setRollingBack(true);
      try {
        const res = await api<{ message: string }>("/api/kiosks/rollback-all", {
          method: "POST",
          json: { removeFromAdmin: false },
        });
        setOkHint(res.message);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Откат не выполнен");
      } finally {
        setRollingBack(false);
      }
      return;
    }
    const ok = await confirmDialog({
      title: "Откатить все киоски?",
      message: "На каждом Windows-ПК будет выполнено удаление Омскэкран и снятие политик.",
      details: "В настройках сбросятся флаги софта и клавиатуры.",
      confirmLabel: "Откатить все",
      tone: "danger",
    });
    if (!ok) return;
    const removeRows = await confirmDialog({
      title: "Удалить из списка?",
      message: "Также удалить записи киосков из админки?",
      details: "Если отменить — ПК останутся в списке для повторной установки.",
      confirmLabel: "Удалить записи",
      cancelLabel: "Оставить в списке",
      tone: "warn",
    });
    setRollingBack(true);
    try {
      const res = await api<{
        ok: boolean;
        message: string;
        failCount: number;
        results: Array<{ hostname: string; ok: boolean; message: string }>;
      }>("/api/kiosks/rollback-all", {
        method: "POST",
        json: { removeFromAdmin: removeRows },
      });
      if (res.failCount) {
        const fails = res.results
          .filter((r) => !r.ok)
          .map((r) => `${r.hostname}: ${r.message}`)
          .join("\n");
        setError(`${res.message}\n${fails}`);
      } else {
        setOkHint(res.message);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Откат не выполнен");
    } finally {
      setRollingBack(false);
    }
  }

  async function onTestWinRm() {
    const host = hostname.trim();
    if (!host) {
      setError("Укажите имя Windows-ПК");
      return;
    }
    setTestBusy(true);
    setError("");
    setTestHint("");
    try {
      const res = await api<{
        ok: boolean;
        hostname: string;
        message: string;
        detail?: string;
      }>("/api/kiosks/test-connection", {
        method: "POST",
        json: { hostname: host },
      });
      const text = res.detail ? `${res.message} — ${res.detail}` : res.message;
      if (res.ok) {
        setTestHint(`${text} · будет добавлен как ${res.hostname}`);
        setHostname(res.hostname);
      } else {
        setError(text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Проверка WinRM не удалась");
    } finally {
      setTestBusy(false);
    }
  }

  async function onCreate(ev: FormEvent) {
    ev.preventDefault();
    setCreating(true);
    setError("");
    try {
      if (installSoftware && deploy && !deploy.packageReady) {
        setError("Сначала на Debian: pnpm pack:kiosk-deploy");
        return;
      }
      const host = hostname.trim();
      const created = await api<KioskDto>("/api/kiosks", {
        method: "POST",
        json: {
          hostname: host,
          name: name.trim() || undefined,
          kioskType,
          exhibitId: kioskType === "exhibit" ? exhibitId || null : null,
          wallTargetKioskId:
            kioskType === "veteran_search" ? wallTargetKioskId || null : null,
          installSoftware,
        },
      });
      setHostname("");
      setName("");
      setExhibitId("");
      setKioskType("exhibit");
      setWallTargetKioskId("");
      setTestHint("");
      setShowAdd(false);
      await load();
      selectKiosk(created.id);
      setOkHint(
        `Киоск ${created.hostname} добавлен${installSoftware ? " · установка по WinRM…" : ""}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setCreating(false);
    }
  }

  async function bind(id: string, nextExhibitId: string) {
    setBinding(id);
    setError("");
    try {
      const dto = await api<KioskDto>(`/api/kiosks/${id}`, {
        method: "PATCH",
        json: { exhibitId: nextExhibitId || null },
      });
      patchKiosk(dto);
      setOkHint("Экспонат сохранён");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBinding(null);
    }
  }

  async function patchType(
    id: string,
    data: { kioskType: KioskType; wallTargetKioskId?: string | null }
  ) {
    setBinding(id);
    setError("");
    try {
      const dto = await api<KioskDto>(`/api/kiosks/${id}`, {
        method: "PATCH",
        json: data,
      });
      patchKiosk(dto);
      setOkHint("Тип киоска сохранён — примените kiosk.json на ПК");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBinding(null);
    }
  }

  async function probe(id: string) {
    setProbing(id);
    try {
      const dto = await api<KioskDto>(`/api/kiosks/${id}/probe`, { method: "POST" });
      patchKiosk(dto);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка опроса");
    } finally {
      setProbing(null);
    }
  }

  async function install(id: string) {
    setInstalling(id);
    setError("");
    try {
      if (deploy && !deploy.packageReady) throw new Error("Пакет не готов");
      const dto = await api<KioskDto>(`/api/kiosks/${id}/install`, { method: "POST" });
      patchKiosk(dto);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка установки");
    } finally {
      setInstalling(null);
    }
  }

  async function cancelInstall(id: string) {
    setCancelling(id);
    try {
      const dto = await api<KioskDto>(`/api/kiosks/${id}/install/cancel`, { method: "POST" });
      patchKiosk(dto);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отменить");
    } finally {
      setCancelling(null);
    }
  }

  async function startKiosk(id: string) {
    setStarting(id);
    setError("");
    try {
      const res = await api<{ message: string; alreadyRunning?: boolean; kiosk: KioskDto }>(
        `/api/kiosks/${id}/start`,
        { method: "POST" }
      );
      patchKiosk(res.kiosk);
      setOkHint(
        res.alreadyRunning ? "Запуск UI уже выполняется — смотрите прогресс" : res.message
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось запустить");
    } finally {
      setStarting(null);
    }
  }

  async function stopKiosk(id: string) {
    const ok = await confirmDialog({
      title: "Выключить киоск?",
      message: "Агент и Edge UI на этом Windows-ПК будут остановлены.",
      confirmLabel: "Выключить",
      tone: "warn",
    });
    if (!ok) return;
    setStopping(id);
    setError("");
    try {
      const res = await api<{ message: string; alreadyRunning?: boolean; kiosk: KioskDto }>(
        `/api/kiosks/${id}/stop`,
        { method: "POST" }
      );
      patchKiosk(res.kiosk);
      setOkHint(
        res.alreadyRunning ? "Остановка уже выполняется — смотрите прогресс" : res.message
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выключить");
    } finally {
      setStopping(null);
    }
  }

  async function saveNetwork(
    id: string,
    data: { healthPort: number; uiPort: number; serverUrl: string }
  ) {
    setSavingNetwork(id);
    try {
      const dto = await api<KioskDto>(`/api/kiosks/${id}`, {
        method: "PATCH",
        json: {
          healthPort: data.healthPort,
          uiPort: data.uiPort,
          serverUrl: data.serverUrl.trim() || null,
        },
      });
      patchKiosk(dto);
      setOkHint("Порты сохранены");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSavingNetwork(null);
    }
  }

  async function pushConfig(id: string) {
    setPushingConfig(id);
    try {
      const res = await api<{ message: string; kiosk?: KioskDto }>(
        `/api/kiosks/${id}/push-config`,
        { method: "POST" }
      );
      if (res.kiosk) patchKiosk(res.kiosk);
      else await load();
      setOkHint(res.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось применить конфиг");
    } finally {
      setPushingConfig(null);
    }
  }

  async function clearPolicies(id: string) {
    const ok = await confirmDialog({
      title: "Снять политики lockdown?",
      message: "Lockdown-политики будут сняты на этом Windows-ПК.",
      details: "Софт киоска не удаляется.",
      confirmLabel: "Снять политики",
      tone: "warn",
    });
    if (!ok) return;
    setClearingPolicies(id);
    setError("");
    try {
      const res = await api<{ message: string; alreadyRunning?: boolean; kiosk: KioskDto }>(
        `/api/kiosks/${id}/clear-policies`,
        { method: "POST" }
      );
      patchKiosk(res.kiosk);
      setOkHint(
        res.alreadyRunning ? "Снятие политик уже выполняется — смотрите прогресс" : res.message
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось снять политики");
    } finally {
      setClearingPolicies(null);
    }
  }

  function toggleChecked(id: string, on: boolean) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleCheckAllFiltered(on: boolean) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      for (const k of filtered) {
        if (on) next.add(k.id);
        else next.delete(k.id);
      }
      return next;
    });
  }

  async function softwareUpdateOne(id: string) {
    const k = kiosks.find((x) => x.id === id);
    const target = deploy?.softwareVersion || "пакет";
    const ok = await confirmDialog({
      title: "Обновить ПО на киоске?",
      message: `Отправить OTA «${k?.name || k?.hostname || id}» → ${target}.`,
      details:
        "Агент скачает update.zip с сервера. Статус в карточке: «Обновляется…» → «Актуальна».",
      confirmLabel: "Обновить ПО",
      tone: "warn",
    });
    if (!ok) return;
    setUpdatingSoftware(id);
    setError("");
    try {
      const res = await api<{
        ok: boolean;
        mode: string;
        message: string;
        targetSoftwareVersion: string | null;
        kiosk?: KioskDto | null;
      }>(`/api/kiosks/${id}/software-update`, { method: "POST" });
      const tgt = res.targetSoftwareVersion || deploy?.softwareVersion || "";
      if (tgt) setOtaWaiting((prev) => ({ ...prev, [id]: tgt }));
      if (res.kiosk) patchKiosk({ ...res.kiosk, otaPending: true, otaTarget: tgt || res.kiosk.otaTarget });
      else {
        setKiosks((prev) =>
          prev.map((row) =>
            row.id === id ? { ...row, otaPending: true, otaTarget: tgt || row.otaTarget } : row
          )
        );
      }
      setOkHint(
        res.message ||
          `OTA запущена → ${tgt || target}. Смотрите блок «Версия ПО»: Обновляется… → Актуальна.`
      );
      window.setTimeout(() => {
        void api<KioskDto>(`/api/kiosks/${id}/probe`, { method: "POST" })
          .then((dto) => patchKiosk(dto))
          .catch(() => null);
      }, 8_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить обновление");
    } finally {
      setUpdatingSoftware(null);
    }
  }

  async function installGame(id: string) {
    setInstallingGame(id);
    setError("");
    try {
      const res = await api<{ message: string; kiosk: KioskDto }>(
        `/api/kiosks/${id}/install-game`,
        { method: "POST", json: {} }
      );
      if (res.kiosk) patchKiosk(res.kiosk);
      setOkHint(res.message || "Проверка игры завершена");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось проверить игру");
    } finally {
      setInstallingGame(null);
    }
  }

  async function softwareUpdateBulk(mode: "selected" | "online") {
    const ids =
      mode === "selected" ? [...checkedIds] : kiosks.filter((k) => k.online).map((k) => k.id);
    if (!ids.length) {
      setError(mode === "selected" ? "Отметьте киоски слева" : "Нет онлайн-киосков");
      return;
    }
    const target = deploy?.softwareVersion || "пакет";
    const ok = await confirmDialog({
      title: mode === "selected" ? "Обновить выбранные?" : "Обновить все онлайн?",
      message: `OTA на ${ids.length} киоск(ов) → ${target}.`,
      details: "У каждого киоска статус OTA станет «Обновляется…» до совпадения версий.",
      confirmLabel: "Обновить ПО",
      tone: "warn",
    });
    if (!ok) return;
    setBulkUpdating(true);
    setError("");
    try {
      const res = await api<{
        targetSoftwareVersion: string | null;
        results: Array<{ id?: string; hostname: string; ok: boolean; mode: string; message: string }>;
      }>("/api/kiosks/software-update", {
        method: "POST",
        json: { ids },
      });
      const tgt = res.targetSoftwareVersion || deploy?.softwareVersion || "";
      if (tgt) {
        setOtaWaiting((prev) => {
          const next = { ...prev };
          for (const id of ids) next[id] = tgt;
          return next;
        });
        setKiosks((prev) =>
          prev.map((row) =>
            ids.includes(row.id) ? { ...row, otaPending: true, otaTarget: tgt } : row
          )
        );
      }
      const okN = res.results.filter((r) => r.ok).length;
      const fails = res.results.filter((r) => !r.ok);
      setOkHint(
        `ПО → ${tgt || target}: ${okN}/${res.results.length}` +
          (fails.length
            ? ` · ошибки: ${fails.map((f) => `${f.hostname} (${f.message})`).join("; ")}`
            : "")
      );
      if (mode === "selected") setCheckedIds(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Массовое обновление не удалось");
    } finally {
      setBulkUpdating(false);
    }
  }

  async function deleteKioskFromAdmin(id: string) {
    setError("");
    const res = await api<{ message: string }>(`/api/kiosks/${id}?purge=0`, { method: "DELETE" });
    const nextId = nextSelectedAfterDelete(
      id,
      kiosks.filter((x) => x.id !== id)
    );
    selectKiosk(nextId);
    await load();
    setOkHint(res.message || "Киоск убран из списка");
  }

  async function removeFromAdmin(id: string) {
    const k = kiosks.find((x) => x.id === id);
    const ok = await confirmDialog({
      title: "Убрать из списка?",
      message: `Киоск «${k?.name || "без названия"}» будет удалён только из админки.`,
      details: "Софт на Windows-ПК останется без изменений.",
      confirmLabel: "Убрать",
      tone: "warn",
    });
    if (!ok) return;
    setRemovingAdmin(id);
    setError("");
    try {
      await deleteKioskFromAdmin(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить");
    } finally {
      setRemovingAdmin(null);
    }
  }

  async function removeFull(id: string) {
    const k = kiosks.find((x) => x.id === id);
    const ok = await confirmDialog({
      title: "Удалить киоск с ПК?",
      message: `«${k?.name || "Киоск"}» будет удалён с Windows-ПК и из админки.`,
      details: "Будет выполнено удаление софта Омскэкран на компьютере.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    setRemovingFull(id);
    setError("");
    try {
      const res = await api<{ message: string }>(`/api/kiosks/${id}`, { method: "DELETE" });
      const nextId = nextSelectedAfterDelete(
        id,
        kiosks.filter((x) => x.id !== id)
      );
      selectKiosk(nextId);
      await load();
      setOkHint(res.message || "Киоск удалён");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось удалить";
      const fallback = await confirmDialog({
        title: "Не удалось удалить с ПК",
        message: msg,
        details: "Удалить только запись из админки, без снятия софта с Windows-ПК?",
        confirmLabel: "Только из списка",
        tone: "warn",
      });
      if (fallback) {
        setRemovingAdmin(id);
        try {
          await deleteKioskFromAdmin(id);
        } catch (e2) {
          setError(e2 instanceof Error ? e2.message : "Не удалось удалить");
        } finally {
          setRemovingAdmin(null);
        }
      } else {
        setError(msg);
      }
    } finally {
      setRemovingFull(null);
    }
  }

  const filterTabs: { id: FilterTab; label: string; count: number }[] = [
    { id: "all", label: "Все", count: stats.total },
    { id: "online", label: "Онлайн", count: stats.online },
    { id: "problems", label: "Проблемы", count: stats.problems },
    { id: "installing", label: "Установка", count: stats.installingCount },
  ];

  const findLabel = useCallback(
    (id: string | null) => {
      if (!id) return undefined;
      return kioskLabel(kiosks.find((x) => x.id === id));
    },
    [kiosks]
  );

  const opRunner = useMemo((): KioskOpRunnerState | null => {
    if (rollingBack) {
      return {
        title: "Откат всех киосков",
        detail: "WinRM: удаление Омскэкран и снятие lockdown-политик на каждом ПК.",
        tone: "danger",
      };
    }
    if (bulkUpdating) {
      const n =
        checkedIds.size ||
        kiosks.filter((k) => k.online).length ||
        kiosks.length;
      return {
        title: "Массовое обновление ПО (OTA)",
        detail: `Отправка сигнала агентам (${n}). Дальше статус «Обновляется…» в карточке.`,
        tone: "warn",
      };
    }
    if (probingAll) {
      return {
        title: "Опрос всех киосков",
        detail: "Проверка health / WinRM по парку.",
        progress: probeAllProgress || undefined,
      };
    }
    if (creating) {
      return {
        title: installSoftware ? "Добавление и установка" : "Добавление киоска",
        target: hostname.trim() || undefined,
        detail: installSoftware
          ? "Создание записи и запуск установки по WinRM…"
          : "Создание записи в админке…",
      };
    }
    if (removingFull) {
      return {
        title: "Удаление с Windows-ПК",
        target: findLabel(removingFull),
        detail: "WinRM: снятие софта Омскэкран и удаление записи из админки.",
        tone: "danger",
      };
    }
    if (removingAdmin) {
      return {
        title: "Удаление из списка",
        target: findLabel(removingAdmin),
        detail: "Удаляется только запись в админке. ПК не трогаем.",
        tone: "warn",
      };
    }
    if (updatingSoftware) {
      return {
        title: "Обновление ПО (OTA)",
        target: findLabel(updatingSoftware),
        detail: "Отправка FORCE_UPDATE агенту…",
        tone: "warn",
      };
    }
    if (installingGame) {
      return {
        title: "Проверка игры",
        target: findLabel(installingGame),
        detail: "Проверка C:\\PatriotGame на киоске…",
      };
    }
    if (installing) {
      return {
        title: "Запуск установки",
        target: findLabel(installing),
        detail: "Постановка задачи WinRM…",
      };
    }
    if (cancelling) {
      return {
        title: "Отмена установки",
        target: findLabel(cancelling),
      };
    }
    if (starting) {
      return {
        title: "Запуск UI",
        target: findLabel(starting),
        detail: "Команда start по WinRM…",
      };
    }
    if (stopping) {
      return {
        title: "Остановка киоска",
        target: findLabel(stopping),
        detail: "Остановка агента и Edge UI…",
        tone: "warn",
      };
    }
    if (clearingPolicies) {
      return {
        title: "Снятие lockdown-политик",
        target: findLabel(clearingPolicies),
        detail: "WinRM: clear policies…",
        tone: "warn",
      };
    }
    if (pushingConfig) {
      return {
        title: "Применение kiosk.json",
        target: findLabel(pushingConfig),
        detail: "Запись конфига на Windows-ПК…",
      };
    }
    if (savingNetwork) {
      return {
        title: "Сохранение сети",
        target: findLabel(savingNetwork),
        detail: "Порты и URL сервера…",
      };
    }
    if (binding) {
      return {
        title: "Привязка экспоната",
        target: findLabel(binding),
      };
    }
    if (probing) {
      return {
        title: "Опрос киоска",
        target: findLabel(probing),
        detail: "Health / статус агента…",
      };
    }
    if (testBusy) {
      return {
        title: "Проверка WinRM",
        target: hostname.trim() || undefined,
        detail: "Тест подключения к Windows-ПК…",
      };
    }
    return null;
  }, [
    rollingBack,
    bulkUpdating,
    checkedIds.size,
    kiosks,
    probingAll,
    probeAllProgress,
    creating,
    installSoftware,
    hostname,
    removingFull,
    removingAdmin,
    updatingSoftware,
    installingGame,
    installing,
    cancelling,
    starting,
    stopping,
    clearingPolicies,
    pushingConfig,
    savingNetwork,
    binding,
    probing,
    testBusy,
    findLabel,
  ]);

  const fleetJobs = useMemo((): FleetJob[] => {
    const jobs: FleetJob[] = [];
    for (const k of kiosks) {
      const name = kioskLabel(k);
      if (k.installStatus === "running" || k.installStatus === "queued") {
        jobs.push({ id: `${k.id}-install`, kioskName: name, label: "Установка софта" });
      }
      if (k.uiStartStatus === "running") {
        jobs.push({ id: `${k.id}-start`, kioskName: name, label: "Запуск UI" });
      }
      if (k.uiStopStatus === "running") {
        jobs.push({ id: `${k.id}-stop`, kioskName: name, label: "Остановка" });
      }
      if (k.policyClearStatus === "running") {
        jobs.push({ id: `${k.id}-policy`, kioskName: name, label: "Снятие политик" });
      }
      if (k.otaPending || otaWaiting[k.id]) {
        jobs.push({
          id: `${k.id}-ota`,
          kioskName: name,
          label: `OTA → ${k.otaTarget || otaWaiting[k.id] || "пакет"}`,
        });
      }
      if (k.gameCopy?.status === "launching" || k.gameCopy?.status === "running") {
        jobs.push({
          id: `${k.id}-game`,
          kioskName: name,
          label: `Игра · ${k.gameCopy.message || "запуск"}`,
        });
      }
    }
    return jobs;
  }, [kiosks, otaWaiting]);

  return {
    canEdit,
    kiosks,
    exhibits,
    deploy,
    deployFleet,
    selected,
    selectedId,
    selectedHiddenByFilter,
    selectKiosk,
    filtered,
    filter,
    setFilter,
    filterTabs,
    search,
    setSearch,
    stats,
    checkedIds,
    toggleChecked,
    toggleCheckAllFiltered,
    showAdd,
    setShowAdd,
    hostname,
    setHostname,
    name,
    setName,
    exhibitId,
    setExhibitId,
    kioskType,
    setKioskType,
    wallTargetKioskId,
    setWallTargetKioskId,
    wallKiosks: kiosks.filter((k) => k.kioskType === "memory_wall"),
    installSoftware,
    setInstallSoftware,
    domainSuffix,
    testBusy,
    testHint,
    setTestHint,
    onTestWinRm,
    onCreate,
    error,
    setError,
    okHint,
    setOkHint,
    refreshing,
    refresh,
    probingAll,
    probeAll,
    rollingBack,
    rollbackAll,
    moreOpen,
    setMoreOpen,
    bulkUpdating,
    softwareUpdateBulk,
    otaWaiting,
    probing,
    installing,
    cancelling,
    starting,
    stopping,
    savingNetwork,
    pushingConfig,
    clearingPolicies,
    updatingSoftware,
    installingGame,
    creating,
    binding,
    removingAdmin,
    removingFull,
    opRunner,
    fleetJobs,
    bind,
    patchType,
    probe,
    install,
    cancelInstall,
    startKiosk,
    stopKiosk,
    softwareUpdateOne,
    installGame,
    removeFromAdmin,
    removeFull,
    saveNetwork,
    pushConfig,
    clearPolicies,
  };
}
