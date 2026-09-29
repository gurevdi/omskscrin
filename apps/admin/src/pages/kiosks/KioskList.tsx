import type { ReactNode } from "react";
import type { KioskDto } from "@stella/shared";
import { KIOSK_TYPE_LABEL, PROBE_STATUS_LABEL } from "@stella/shared";
import {
  otaListTagClass,
  otaListTagText,
  resolveOtaState,
} from "../../components/kiosk/KioskOtaStatus";
import type { FilterTab } from "./kioskHelpers";
import { kioskBusyLabel, kioskDotClass, shortHostname } from "./kioskHelpers";

type Props = {
  filtered: KioskDto[];
  totalCount: number;
  canEdit: boolean;
  selectedId: string | null;
  filter: FilterTab;
  filterTabs: { id: FilterTab; label: string; count: number }[];
  search: string;
  onSearch: (v: string) => void;
  onFilter: (f: FilterTab) => void;
  checkedIds: Set<string>;
  onToggleChecked: (id: string, on: boolean) => void;
  onToggleCheckAll: (on: boolean) => void;
  onSelect: (id: string) => void;
  deploySoftwareVersion: string | null;
  otaWaiting: Record<string, string>;
  addSlot?: ReactNode;
};

export function KioskList(props: Props) {
  const {
    filtered,
    totalCount,
    canEdit,
    selectedId,
    filter,
    filterTabs,
    search,
    onSearch,
    onFilter,
    checkedIds,
    onToggleChecked,
    onToggleCheckAll,
    onSelect,
    deploySoftwareVersion,
    otaWaiting,
    addSlot,
  } = props;

  return (
    <aside className="kx-list">
      <div className="kx-list__toolbar">
        <input
          type="search"
          className="kx-list__search"
          placeholder="Поиск по имени или hostname…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <div className="kx-filters" role="tablist">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              className={`kx-filter ${filter === tab.id ? "is-active" : ""}`}
              onClick={() => onFilter(tab.id)}
            >
              {tab.label}
              <span className="kx-filter__n">{tab.count}</span>
            </button>
          ))}
        </div>
        {addSlot}
      </div>

      <div className="kx-items">
        {canEdit && filtered.length ? (
          <label className="kx-select-all checkbox-label">
            <input
              type="checkbox"
              checked={filtered.every((k) => checkedIds.has(k.id))}
              onChange={(e) => onToggleCheckAll(e.target.checked)}
            />
            Выбрать все ({filtered.length})
          </label>
        ) : null}

        {filtered.map((k) => {
          const busy = kioskBusyLabel(k);
          const otaState = resolveOtaState(
            k.softwareVersion,
            k.otaTarget || deploySoftwareVersion,
            Boolean(k.otaPending || otaWaiting[k.id])
          );
          return (
            <div
              key={k.id}
              className={`kx-item ${selectedId === k.id ? "is-selected" : ""} ${busy ? "is-busy" : ""}`}
            >
              {canEdit ? (
                <input
                  type="checkbox"
                  className="kx-item__check"
                  checked={checkedIds.has(k.id)}
                  aria-label={`Выбрать ${k.name}`}
                  onChange={(e) => onToggleChecked(k.id, e.target.checked)}
                />
              ) : null}
              <button type="button" className="kx-item__btn" onClick={() => onSelect(k.id)}>
                <div className="kx-item__row">
                  <div className="kx-item__titles">
                    <span className="kx-item__name">{k.name}</span>
                    <span className="kx-item__host">{shortHostname(k.hostname)}</span>
                  </div>
                  <span
                    className={`kx-item__dot ${kioskDotClass(k)}`}
                    title={PROBE_STATUS_LABEL[k.probeStatus]}
                  />
                </div>
                <div className="kx-item__foot">
                  <span className={`kx-item__tag ${k.online ? "is-live" : ""}`}>
                    {k.online ? "онлайн" : "офлайн"}
                  </span>
                  {k.kioskType && k.kioskType !== "exhibit" ? (
                    <span className="kx-item__tag is-type">{KIOSK_TYPE_LABEL[k.kioskType]}</span>
                  ) : null}
                  <span
                    className={`kx-item__tag ${otaListTagClass(otaState)}`}
                    title={
                      otaState === "current"
                        ? `ПО актуально: ${k.softwareVersion}`
                        : otaState === "pending"
                          ? `OTA → ${k.otaTarget || deploySoftwareVersion || "?"}`
                          : otaState === "outdated"
                            ? `На киоске ${k.softwareVersion || "—"} · сервер ${k.otaTarget || deploySoftwareVersion || "—"}`
                            : "Версия ПО неизвестна"
                    }
                  >
                    {otaListTagText(otaState, k.softwareVersion)}
                  </span>
                  {busy ? <span className="kx-item__tag is-busy">{busy}</span> : null}
                </div>
              </button>
            </div>
          );
        })}

        {!filtered.length ? (
          <div className="cx-empty">
            <p className="cx-empty__title">
              {totalCount ? "Ничего не найдено" : "Киосков пока нет"}
            </p>
            <p className="muted">
              {totalCount
                ? "Измените фильтр или поиск."
                : canEdit
                  ? "Нажмите «Добавить киоск»."
                  : "Список пуст."}
            </p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
