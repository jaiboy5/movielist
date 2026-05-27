// app.jsx — JAI × HOMA WATCHLIST

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": "neon",
  "scanlines": true,
  "sticker": true
}/*EDITMODE-END*/;

const uid = () =>
  (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);

const makeBlank = () => ({
  id: uid(), title: "", year: "", who: "", hype: 0, watched: false, watchedDate: ""
});

const seedList = () => [
  ...Array.from({ length: 10 }, makeBlank),
  ...Array.from({ length: 3 }, makeBlank)
];

// ─── Firebase wait ───────────────────────────────────────────────────────
function whenFbReady() {
  return new Promise((resolve) => {
    if (window.__fb) return resolve(window.__fb);
    window.addEventListener("fb:ready", () => resolve(window.__fb), { once: true });
  });
}

const fmtDate = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${dd}`;
};

const today = fmtDate();

// (loadInitial removed — list now comes from Firestore)

function HypeDots({ value, onChange }) {
  return (
    <div className="hype-cell" title="Hype level">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={"hype-dot " + (n <= value ? "on" : "")}
          onClick={() => onChange(value === n ? 0 : n)}
          aria-label={`Hype ${n}`}
        >
          {n <= value ? "▰" : "▱"}
        </button>
      ))}
    </div>
  );
}

function WhoToggle({ value, onChange }) {
  return (
    <div className="who-cell" title="Suggested by">
      <button
        className={"who-btn j " + (value === "J" ? "active" : "")}
        onClick={() => onChange(value === "J" ? "" : "J")}
        aria-label="Suggested by Jai"
      >J</button>
      <button
        className={"who-btn h " + (value === "H" ? "active" : "")}
        onClick={() => onChange(value === "H" ? "" : "H")}
        aria-label="Suggested by Homa"
      >H</button>
    </div>
  );
}

function Row({ m, index, update, remove }) {
  return (
    <div className="row" data-row={m.id}>
      <div className="num">{String(index + 1).padStart(2, "0")}</div>
      <input
        className="title-input"
        placeholder="add a film…"
        value={m.title}
        onChange={(e) => update({ title: e.target.value })}
      />
      <input
        className="year-input"
        placeholder="—"
        maxLength={4}
        value={m.year}
        onChange={(e) => update({ year: e.target.value.replace(/[^\d]/g, "") })}
      />
      <WhoToggle value={m.who} onChange={(v) => update({ who: v })} />
      <HypeDots value={m.hype} onChange={(v) => update({ hype: v })} />
      <div className="watch-cell">
        <button
          className={"check " + (m.watched ? "on" : "")}
          onClick={() =>
            update(
              m.watched
                ? { watched: false, watchedDate: "" }
                : { watched: true, watchedDate: m.watchedDate || today }
            )
          }
          aria-label="Watched"
        />
        <span className={"stamp " + (m.watched ? "on" : "")}>
          {m.watched ? m.watchedDate : "—"}
        </span>
      </div>
      <button className="del" onClick={() => remove(m.id)} aria-label="Delete row" title="Delete">×</button>
    </div>
  );
}

function ListHead() {
  return (
    <div className="list-head">
      <div className="num">#</div>
      <div>Title</div>
      <div>Year</div>
      <div className="col-who">By</div>
      <div className="col-hype">Hype</div>
      <div className="col-watch">Seen</div>
      <div />
    </div>
  );
}

function Section({ title, badge, side, movies, update, remove, add }) {
  return (
    <section className={"section side-" + side}>
      <div className="section-head">
        <span className="side-badge">{badge}</span>
        <h2>{title}</h2>
        <span className="section-meta">
          <b>{String(movies.length).padStart(3, "0")}</b> ENTRIES
        </span>
      </div>
      <div className="list">
        <ListHead />
        {movies.length === 0 ? (
          <div className="row" style={{ color: "var(--ink-dim)", fontStyle: "italic", padding: "18px 14px", gridTemplateColumns: "1fr" }}>
            — no entries —
          </div>
        ) : (
          movies.map((m, i) => (
            <Row key={m.id} m={m} index={i} update={(p) => update(m.id, p)} remove={remove} />
          ))
        )}
      </div>
      {add && (
        <button className="add-row" onClick={add}>+ ADD TITLE</button>
      )}
    </section>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [movies, setMovies] = React.useState(null);   // null = still loading
  const [sync, setSync]     = React.useState("connecting"); // connecting|live|saving|offline
  const [room, setRoom]     = React.useState("");
  const [errMsg, setErrMsg] = React.useState("");

  // refs used to break the remote→local→remote write loop
  const lastRemoteRef  = React.useRef(null);  // tracks the last array received from Firestore
  const fbRef          = React.useRef(null);
  const saveTimer      = React.useRef(null);

  // Subscribe once
  React.useEffect(() => {
    let unsub = null;
    let cancelled = false;

    // Safety net: if Firebase doesn't connect within 6s (no rules, blocked, etc.)
    // fall back to a local-only seed so the UI is still usable.
    const offlineFallback = setTimeout(() => {
      if (cancelled) return;
      setMovies((m) => m === null ? seedList() : m);
      setSync((s) => s === "live" || s === "saving" ? s : "offline");
    }, 6000);

    whenFbReady().then((fb) => {
      if (cancelled) return;
      fbRef.current = fb;
      setRoom(fb.ROOM);
      unsub = fb.onSnapshot(
        (snap) => {
          if (cancelled) return;
          clearTimeout(offlineFallback);
          if (snap.exists() && Array.isArray(snap.data().movies)) {
            lastRemoteRef.current = snap.data().movies;
            setMovies(snap.data().movies);
          } else if (!snap.exists()) {
            // Genuinely new document — seed it for the first time
            const seed = seedList();
            lastRemoteRef.current = seed;
            setMovies(seed);
            fb.setDoc({ movies: seed }).catch((err) => {
              console.error("[firestore write]", err);
              setSync("offline");
              setErrMsg(err.code === "permission-denied"
                ? "Rules not published — see console.firebase.google.com → Firestore → Rules"
                : err.message);
            });
          } else {
            // Document exists but data is unexpected — do NOT overwrite
            console.error("[firestore] unexpected data format, not overwriting:", snap.data());
            setSync("offline");
            setErrMsg("Unexpected data format in Firestore — not overwriting");
            return;
          }
          setSync("live");
          setErrMsg("");
        },
        (err) => {
          console.error("[firestore read]", err);
          if (cancelled) return;
          clearTimeout(offlineFallback);
          setMovies((m) => m === null ? seedList() : m);
          setSync("offline");
          setErrMsg(err.code === "permission-denied"
            ? "Rules not published — see console.firebase.google.com → Firestore → Rules"
            : err.message);
        }
      );
    });

    return () => {
      cancelled = true;
      clearTimeout(offlineFallback);
      if (unsub) unsub();
    };
  }, []);

  // Debounced push to Firestore on any local change
  React.useEffect(() => {
    if (movies === null) return;                    // not loaded yet
    if (movies === lastRemoteRef.current) return;   // change came FROM Firestore
    if (!fbRef.current) return;
    if (sync === "offline") return;         // don't try to save when we know we can't
    setSync("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fbRef.current.setDoc({ movies })
        .then(() => { setSync("live"); setErrMsg(""); })
        .catch((err) => {
          console.error(err);
          setSync("offline");
          setErrMsg(err.code === "permission-denied"
            ? "Rules not published — see console.firebase.google.com → Firestore → Rules"
            : err.message);
        });
    }, 500);
  }, [movies]);

  const update = React.useCallback((id, patch) => {
    setMovies((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);
  const remove = React.useCallback((id) => {
    setMovies((ms) => ms.filter((m) => m.id !== id));
  }, []);
  const add = React.useCallback(() => {
    setMovies((ms) => [...ms, makeBlank()]);
  }, []);
  const clearAll = () => {
    if (confirm("Wipe the whole shared list? This affects both of you.")) {
      const fresh = seedList();
      setMovies(fresh);
    }
  };

  // loading splash
  if (movies === null) {
    return (
      <div className="page">
        <div style={{
          minHeight: "70vh", display: "grid", placeItems: "center",
          fontFamily: "'VT323',monospace", fontSize: 28, letterSpacing: ".25em",
          color: "var(--ink-dim)"
        }}>
          <div style={{ textAlign: "center" }}>
            <div className="dot live" style={{ display: "inline-block", marginRight: 12 }}></div>
            CUEING TAPE…
          </div>
        </div>
      </div>
    );
  }

  const toWatch = movies.filter((m) => !m.watched);
  const watched = movies.filter((m) => m.watched);

  return (
    <div className={"page palette-" + t.palette}>
      {/* Sleeve / header */}
      <div className="sleeve">
        <div className="tape-band" />
        <div className="sleeve-body">
          <div className="left-col">
            <div className="label-club">⌬ JAI × HOMA VIDEO CLUB ⌬</div>
            <h1 className="marquee">
              WATCH<br/>LIST
              <small>VOL.01 · NOT FOR RESALE</small>
            </h1>
            <div className="strip">
              <span><i className="dot live"></i> REC</span>
              <i>//</i>
              <span>NTSC</span>
              <i>//</i>
              <span>SP · 120 MIN</span>
              <i>//</i>
              <span>EST. {new Date().getFullYear()}</span>
            </div>
          </div>
          <div className="right-col">
            <div className="sticker">BE KIND<span className="sm">REWIND</span></div>
            <div className="member">
              <div className="member-inner">
                <span><b>MEMBER</b></span><span>#001</span>
                <span><b>NAME</b></span><span>JAI & HOMA</span>
                <span><b>STATUS</b></span><span>ACTIVE</span>
                <span><b>RENTALS</b></span><span>∞</span>
              </div>
              <div className="barcode" />
              <div className="barcode-num">0 1 9 8 4 · {today.replace(/\./g," ")}</div>
            </div>
          </div>
        </div>
        <div className="perf" />
      </div>

      {/* Toolbar */}
      <div className="toolbar" style={{ marginTop: 28 }}>
        <span className={"sync-pill sync-" + sync} title={"Room: " + (room || "—")}>
          <i className="sync-led" />
          {sync === "live"    && "SYNCED"}
          {sync === "saving"  && "SAVING…"}
          {sync === "connecting" && "CONNECTING…"}
          {sync === "offline" && "OFFLINE"}
        </span>
        {sync === "offline" && errMsg && (
          <span className="sync-hint">{errMsg}</span>
        )}
        <button className="tbtn" onClick={() => window.print()}>⎙ PRINT / EXPORT</button>
        <button className="tbtn" onClick={clearAll}>⟲ RESET</button>
      </div>

      <Section
        title="TO WATCH"
        badge="A · SIDE"
        side="a"
        movies={toWatch}
        update={update}
        remove={remove}
        add={add}
      />

      <Section
        title="WATCHED"
        badge="B · SIDE"
        side="b"
        movies={watched}
        update={update}
        remove={remove}
        add={null}
      />

      <footer className="footer">
        <div className="ll">
          <span className="ok">OK</span>
          <span>© JAI × HOMA VIDEO CLUB</span>
          <i style={{opacity:.4}}>//</i>
          <span>PLEASE REWIND</span>
        </div>
        <div>LATE FEES APPLY · CH 03 · {today}</div>
      </footer>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Look" />
        <TweakRadio
          label="Palette"
          value={t.palette}
          options={[
            { value: "neon",   label: "Neon" },
            { value: "acid",   label: "Acid" },
            { value: "sunset", label: "Sunset" },
            { value: "cobalt", label: "Cobalt" }
          ]}
          onChange={(v) => setTweak("palette", v)}
        />
        <TweakToggle
          label="Scanlines"
          value={t.scanlines}
          onChange={(v) => {
            setTweak("scanlines", v);
            document.body.dataset.scanlines = String(v);
          }}
        />
        <TweakToggle
          label="Rewind sticker"
          value={t.sticker}
          onChange={(v) => {
            setTweak("sticker", v);
            document.body.dataset.sticker = String(v);
          }}
        />
      </TweaksPanel>
    </div>
  );
}

// Reflect initial tweak state on body so CSS rules see it before React mounts effects.
(() => {
  document.body.dataset.scanlines = String(TWEAK_DEFAULTS.scanlines);
  document.body.dataset.sticker   = String(TWEAK_DEFAULTS.sticker);
})();

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
