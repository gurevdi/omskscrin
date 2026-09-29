import { useCallback, useEffect, useState } from "react";
import type { KioskConfig } from "../config";
import type { WallStateDto, WallVeteranPayload } from "@stella/shared";
import { WALL_SHOW_TTL_SEC } from "@stella/shared";

const PAMYAT_HEROES = "https://pamyat-naroda.ru/heroes/";

function agentBase(config: KioskConfig) {
  return `http://127.0.0.1:${config.healthPort || 47821}`;
}

export function SearchKioskApp({ config }: { config: KioskConfig }) {
  const [heroUrl, setHeroUrl] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [peerOk, setPeerOk] = useState<boolean | null>(null);

  const pingPeer = useCallback(async () => {
    try {
      const r = await fetch(`${agentBase(config)}/peer/ping`, { cache: "no-store" });
      const j = await r.json();
      setPeerOk(Boolean(j?.hasWallPeer));
    } catch {
      setPeerOk(false);
    }
  }, [config]);

  useEffect(() => {
    void pingPeer();
    const id = window.setInterval(() => void pingPeer(), 15_000);
    return () => window.clearInterval(id);
  }, [pingPeer]);

  async function sendToWall() {
    setBusy(true);
    setError("");
    setMessage("");
    const url = heroUrl.trim();
    if (!url) {
      setError("Вставьте ссылку на страницу героя с Память народа");
      setBusy(false);
      return;
    }
    if (!/^https?:\/\/([a-z0-9-]+\.)*pamyat-naroda\.ru\//i.test(url)) {
      setError("Ссылка должна быть на pamyat-naroda.ru");
      setBusy(false);
      return;
    }
    const veteran: WallVeteranPayload = {
      sourceUrl: url,
      fullName: fullName.trim() || null,
    };
    try {
      const r = await fetch(`${agentBase(config)}/peer/wall/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlSec: config.wallShowTtlSec || WALL_SHOW_TTL_SEC, veteran }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || `Ошибка ${r.status}`);
      }
      setMessage("Отправлено на Стену памяти");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить на стену");
    } finally {
      setBusy(false);
    }
  }

  async function clearWall() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`${agentBase(config)}/peer/wall/send-clear`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `Ошибка ${r.status}`);
      setMessage("Стена сброшена");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сбросить стену");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mw-search">
      <header className="mw-search__bar">
        <div className="mw-search__brand">
          <strong>Поиск ветерана</strong>
          <span>Память народа</span>
        </div>
        <div className="mw-search__peer">
          {peerOk === null ? "Стена…" : peerOk ? "Стена настроена" : "Стена не привязана"}
        </div>
      </header>

      <div className="mw-search__frame-wrap">
        <iframe
          className="mw-search__frame"
          title="Память народа — поиск"
          src={PAMYAT_HEROES}
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>

      <footer className="mw-search__dock">
        <p className="mw-search__hint">
          Найдите героя на сайте выше. Откройте его карточку, скопируйте ссылку из браузера сайта
          (или из «Поделиться») и вставьте ниже — затем нажмите «Показать на стене».
        </p>
        <div className="mw-search__fields">
          <label>
            Ссылка на героя
            <input
              type="url"
              value={heroUrl}
              onChange={(e) => setHeroUrl(e.target.value)}
              placeholder="https://pamyat-naroda.ru/heroes/…"
              autoComplete="off"
            />
          </label>
          <label>
            ФИО (необязательно)
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иванов Иван Иванович"
              autoComplete="off"
            />
          </label>
        </div>
        <div className="mw-search__actions">
          <button type="button" className="mw-btn" disabled={busy || !peerOk} onClick={() => void sendToWall()}>
            {busy ? "Отправка…" : "Показать на стене"}
          </button>
          <button type="button" className="mw-btn mw-btn--ghost" disabled={busy || !peerOk} onClick={() => void clearWall()}>
            Сбросить стену
          </button>
        </div>
        {message ? <p className="mw-search__ok">{message}</p> : null}
        {error ? <p className="mw-search__err">{error}</p> : null}
      </footer>
    </div>
  );
}

export function WallKioskApp({ config }: { config: KioskConfig }) {
  const [state, setState] = useState<WallStateDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch(`${agentBase(config)}/peer/wall/state`, { cache: "no-store" });
        const j = (await r.json()) as WallStateDto;
        if (!cancelled) setState(j);
      } catch {
        if (!cancelled) {
          setState({
            status: "idle",
            veteran: null,
            sourceHostname: null,
            shownAt: null,
            expiresAt: null,
            ttlSec: config.wallShowTtlSec || WALL_SHOW_TTL_SEC,
          });
        }
      }
    }
    void poll();
    const id = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [config]);

  const showing = state?.status === "showing" && state.veteran?.sourceUrl;
  const remainingMs =
    showing && state?.expiresAt ? Math.max(0, Date.parse(state.expiresAt) - Date.now()) : 0;
  const remainingMin = Math.ceil(remainingMs / 60_000);

  if (showing && state?.veteran) {
    return (
      <div className="mw-wall mw-wall--showing">
        <div className="mw-wall__chrome">
          <span>Стена памяти</span>
          {state.veteran.fullName ? <strong>{state.veteran.fullName}</strong> : null}
          <span className="mw-wall__ttl">ещё ~{remainingMin} мин</span>
        </div>
        <iframe
          className="mw-wall__frame"
          title={state.veteran.fullName || "Герой"}
          src={state.veteran.sourceUrl}
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    );
  }

  return (
    <div className="mw-wall mw-wall--idle">
      <div className="mw-wall__idle-inner">
        <p className="mw-wall__eyebrow">Парк Победы</p>
        <h1>Стена памяти</h1>
        <p>Выберите героя на киоске поиска — карточка появится здесь</p>
      </div>
    </div>
  );
}
