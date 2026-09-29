import { FormEvent } from "react";
import type { KioskType } from "@stella/shared";
import { KIOSK_TYPE_LABEL } from "@stella/shared";
import { Alert } from "../../components/ui/Alert";
import { Card } from "../../components/ui/Card";
import type { ExhibitOpt } from "./kioskHelpers";

type WallOpt = { id: string; name: string; hostname: string };

type Props = {
  open: boolean;
  onToggle: () => void;
  hostname: string;
  onHostname: (v: string) => void;
  name: string;
  onName: (v: string) => void;
  kioskType: KioskType;
  onKioskType: (v: KioskType) => void;
  wallTargetKioskId: string;
  onWallTargetKioskId: (v: string) => void;
  wallKiosks: WallOpt[];
  exhibitId: string;
  onExhibitId: (v: string) => void;
  exhibits: ExhibitOpt[];
  installSoftware: boolean;
  onInstallSoftware: (v: boolean) => void;
  domainSuffix: string;
  packageReady: boolean;
  testBusy: boolean;
  creating?: boolean;
  testHint: string;
  onClearTestHint: () => void;
  onTestWinRm: () => void;
  onSubmit: (ev: FormEvent) => void;
};

export function KioskAddForm(props: Props) {
  return (
    <>
      <button
        type="button"
        className={`btn secondary kx-add-toggle ${props.open ? "is-active" : ""}`}
        onClick={props.onToggle}
      >
        {props.open ? "Скрыть форму" : "+ Добавить киоск"}
      </button>
      {props.open ? (
        <Card title="Новый киоск (домен / WinRM)">
          <form className="kx-add-form" onSubmit={props.onSubmit}>
            <label>
              Имя Windows-ПК
              <input
                required
                value={props.hostname}
                onChange={(e) => {
                  props.onHostname(e.target.value);
                  props.onClearTestHint();
                }}
                placeholder={`itpc07 или itpc07.${props.domainSuffix}`}
                autoComplete="off"
              />
            </label>
            <p className="cx-setting__hint" style={{ margin: 0 }}>
              Короткое имя дополнится до <code>*.{props.domainSuffix}</code>. Подключение с Debian
              по WinRM. Учётку задайте в Настройки → Windows.
            </p>
            <label>
              Название в админке
              <input
                value={props.name}
                onChange={(e) => props.onName(e.target.value)}
                placeholder="Стелла · зал 1"
              />
            </label>
            <label>
              Тип киоска
              <select
                value={props.kioskType}
                onChange={(e) => props.onKioskType(e.target.value as KioskType)}
              >
                {(Object.keys(KIOSK_TYPE_LABEL) as KioskType[]).map((t) => (
                  <option key={t} value={t}>
                    {KIOSK_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            {props.kioskType === "exhibit" ? (
              <label>
                Экспонат
                <select value={props.exhibitId} onChange={(e) => props.onExhibitId(e.target.value)}>
                  <option value="">— не привязан —</option>
                  {props.exhibits.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {props.kioskType === "veteran_search" ? (
              <label>
                Целевая стена памяти
                <select
                  value={props.wallTargetKioskId}
                  onChange={(e) => props.onWallTargetKioskId(e.target.value)}
                >
                  <option value="">— не выбрана —</option>
                  {props.wallKiosks.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.hostname})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={props.installSoftware}
                onChange={(e) => props.onInstallSoftware(e.target.checked)}
              />
              Сразу установить софт по WinRM
            </label>
            {props.testHint ? <Alert tone="success">{props.testHint}</Alert> : null}
            <div className="kx-add-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={props.testBusy || props.creating || !props.hostname.trim()}
                onClick={() => void props.onTestWinRm()}
              >
                {props.testBusy ? "Проверка…" : "Проверить WinRM"}
              </button>
              <button
                className="btn"
                disabled={props.creating || (props.installSoftware && !props.packageReady)}
              >
                {props.creating ? "Добавление…" : "Добавить"}
              </button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
