import { DeployStatusPanel } from "../components/kiosk/DeployStatusPanel";
import { KioskFleetJobsBanner, KioskOpRunner } from "../components/kiosk/KioskOpRunner";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";
import { Stat, StatGrid } from "../components/ui/StatGrid";
import { KioskAddForm } from "./kiosks/KioskAddForm";
import { KioskDetail } from "./kiosks/KioskDetail";
import { KioskList } from "./kiosks/KioskList";
import { useKiosksPage } from "./kiosks/useKiosksPage";

export function KiosksPage() {
  const p = useKiosksPage();

  return (
    <>
      <PageShell
      section="Киоски"
      title="Управление"
      description="Установка, OTA, старт UI, экспонаты и проверка игры на киосках."
        wide
        actions={
          <div className="kx-page-actions">
            <button
              type="button"
              className="btn ghost"
              disabled={p.refreshing || Boolean(p.opRunner)}
              onClick={() => void p.refresh()}
            >
              {p.refreshing ? "…" : "Обновить"}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={p.probingAll || !p.kiosks.length || Boolean(p.opRunner)}
              onClick={() => void p.probeAll()}
            >
              {p.probingAll ? "…" : "Опросить"}
            </button>
            {p.canEdit ? (
              <>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={
                    p.bulkUpdating ||
                    !p.deploy?.packageReady ||
                    !p.checkedIds.size ||
                    Boolean(p.opRunner)
                  }
                  onClick={() => void p.softwareUpdateBulk("selected")}
                >
                  {p.bulkUpdating ? "…" : `OTA (${p.checkedIds.size || 0})`}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={
                    p.bulkUpdating ||
                    !p.deploy?.packageReady ||
                    !p.stats.online ||
                    Boolean(p.opRunner)
                  }
                  onClick={() => void p.softwareUpdateBulk("online")}
                >
                  {p.bulkUpdating ? "…" : "OTA онлайн"}
                </button>
                <div className="kx-more">
                  <button
                    type="button"
                    className="btn ghost"
                    aria-expanded={p.moreOpen}
                    disabled={Boolean(p.opRunner)}
                    onClick={() => p.setMoreOpen((v) => !v)}
                  >
                    Ещё
                  </button>
                  {p.moreOpen ? (
                    <div className="kx-more__menu" role="menu">
                      <button
                        type="button"
                        className="btn danger"
                        disabled={p.rollingBack || Boolean(p.opRunner)}
                        onClick={() => void p.rollbackAll()}
                      >
                        {p.rollingBack ? "Откат…" : "Откатить все"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        }
        banner={
          <>
            {p.okHint ? (
              <Alert tone="success" onDismiss={() => p.setOkHint("")}>
                {p.okHint}
              </Alert>
            ) : null}
            {p.error ? (
              <Alert tone="error" onDismiss={() => p.setError("")}>
                {p.error}
              </Alert>
            ) : null}
            <KioskFleetJobsBanner jobs={p.fleetJobs} />
            {p.deploy ? (
              <DeployStatusPanel
                deploy={p.deploy}
                onRefresh={p.refresh}
                refreshing={p.refreshing}
                fleet={p.deployFleet}
              />
            ) : null}
          </>
        }
      >
        <StatGrid columns={5}>
          <Stat label="Всего" value={p.stats.total} />
          <Stat label="Healthy" value={p.stats.healthy} tone="ok" />
          <Stat label="Онлайн" value={p.stats.online} tone="ok" />
          <Stat
            label="Установка"
            value={p.stats.installingCount}
            tone={p.stats.installingCount ? "warn" : "default"}
          />
          <Stat
            label="Проблемы"
            value={p.stats.problems}
            tone={p.stats.problems ? "bad" : "default"}
          />
        </StatGrid>

        <div className="kx-workspace">
          <KioskList
            filtered={p.filtered}
            totalCount={p.kiosks.length}
            canEdit={p.canEdit}
            selectedId={p.selectedId}
            filter={p.filter}
            filterTabs={p.filterTabs}
            search={p.search}
            onSearch={p.setSearch}
            onFilter={p.setFilter}
            checkedIds={p.checkedIds}
            onToggleChecked={p.toggleChecked}
            onToggleCheckAll={p.toggleCheckAllFiltered}
            onSelect={p.selectKiosk}
            deploySoftwareVersion={p.deploy?.softwareVersion ?? null}
            otaWaiting={p.otaWaiting}
            addSlot={
              p.canEdit ? (
                <KioskAddForm
                  open={p.showAdd}
                  onToggle={() => p.setShowAdd((v) => !v)}
                  hostname={p.hostname}
                  onHostname={p.setHostname}
                  name={p.name}
                  onName={p.setName}
                  kioskType={p.kioskType}
                  onKioskType={p.setKioskType}
                  wallTargetKioskId={p.wallTargetKioskId}
                  onWallTargetKioskId={p.setWallTargetKioskId}
                  wallKiosks={p.wallKiosks}
                  exhibitId={p.exhibitId}
                  onExhibitId={p.setExhibitId}
                  exhibits={p.exhibits}
                  installSoftware={p.installSoftware}
                  onInstallSoftware={p.setInstallSoftware}
                  domainSuffix={p.domainSuffix}
                  packageReady={!!p.deploy?.packageReady}
                  testBusy={p.testBusy}
                  creating={p.creating}
                  testHint={p.testHint}
                  onClearTestHint={() => p.setTestHint("")}
                  onTestWinRm={() => void p.onTestWinRm()}
                  onSubmit={(ev) => void p.onCreate(ev)}
                />
              ) : null
            }
          />

          {p.selected ? (
            <KioskDetail
              kiosk={p.selected}
              exhibits={p.exhibits}
              wallKiosks={p.wallKiosks}
              canEdit={p.canEdit}
              deployReady={!!p.deploy?.packageReady}
              probing={p.probing === p.selected.id}
              installing={p.installing === p.selected.id}
              cancelling={p.cancelling === p.selected.id}
              starting={p.starting === p.selected.id}
              stopping={p.stopping === p.selected.id}
              savingNetwork={p.savingNetwork === p.selected.id}
              pushingConfig={p.pushingConfig === p.selected.id}
              clearingPolicies={p.clearingPolicies === p.selected.id}
              updatingSoftware={p.updatingSoftware === p.selected.id}
              installingGame={p.installingGame === p.selected.id}
              binding={p.binding === p.selected.id}
              removingAdmin={p.removingAdmin === p.selected.id}
              removingFull={p.removingFull === p.selected.id}
              otaPending={Boolean(p.selected.otaPending || p.otaWaiting[p.selected.id])}
              targetSoftwareVersion={p.selected.otaTarget || p.deploy?.softwareVersion || null}
              hiddenByFilter={p.selectedHiddenByFilter}
              onBind={p.bind}
              onPatchType={p.patchType}
              onProbe={p.probe}
              onInstall={p.install}
              onCancel={p.cancelInstall}
              onStart={p.startKiosk}
              onStop={p.stopKiosk}
              onSoftwareUpdate={p.softwareUpdateOne}
              onInstallGame={p.installGame}
              onRemoveFromAdmin={p.removeFromAdmin}
              onRemoveFull={p.removeFull}
              onSaveNetwork={p.saveNetwork}
              onPushConfig={p.pushConfig}
              onClearPolicies={p.clearPolicies}
            />
          ) : (
            <div className="kx-panel__empty">
              <p className="cx-empty__title">Выберите киоск слева</p>
              <p className="muted">Управление, OTA, сеть и удаление появятся здесь.</p>
            </div>
          )}
        </div>
      </PageShell>
      <KioskOpRunner op={p.opRunner} />
    </>
  );
}
