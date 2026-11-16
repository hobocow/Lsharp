"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerationDto } from "@/server/generations";
import { api, HttpError, errorText, haptic, tg, inTelegram, postJson, prepareUpload, downloadImage } from "@/lib/client";
import { IconUpload, IconPlus, IconDownload, IconRefresh, IconSparkle, IconEdit, IconClose } from "./Icons";
import { TopUpSheet } from "./TopUpSheet";
import { Viewer } from "./Viewer";

type Me = { user: { name: string; credits: number }; costPerEdit: number; tokens: string[] };
type Props = { appName: string; botUsername: string };

const IDEAS = ["Golden hour lighting", "Clean studio background", "Make it a film photo", "Turn day into night", "Remove the clutter"];

export function App({ appName, botUsername }: Props) {
  const [me, setMe] = useState<Me | null>(null);
  const [auth, setAuth] = useState<"loading" | "in" | "out">("loading");
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [job, setJob] = useState<GenerationDto | null>(null);
  const [jobInput, setJobInput] = useState<{ file: Blob; prompt: string; preview: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<GenerationDto[] | null>(null);
  const [sheet, setSheet] = useState(false);
  const [viewer, setViewer] = useState<GenerationDto | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const credits = me?.user.credits ?? 0;
  const cost = me?.costPerEdit ?? 1;
  const setCredits = (c: number) => setMe((m) => (m ? { ...m, user: { ...m.user, credits: c } } : m));
  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  // ---- Boot: existing session, else Telegram Mini App sign-in ----
  useEffect(() => {
    const t = tg();
    if (t) {
      t.ready();
      t.expand();
      if (t.colorScheme) document.documentElement.dataset.theme = t.colorScheme;
    }
    (async () => {
      try {
        setMe(await api<Me>("/api/me"));
        setAuth("in");
        return;
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 401)) {
          setAuth("out");
          return;
        }
      }
      if (inTelegram()) {
        try {
          await postJson("/api/auth/telegram", { initData: tg()!.initData });
          setMe(await api<Me>("/api/me"));
          setAuth("in");
          return;
        } catch {
          /* fall through */
        }
      }
      setAuth("out");
    })();
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const r = await api<{ items: GenerationDto[] }>("/api/generations");
      setHistory(r.items);
    } catch {
      setHistory((h) => h ?? []);
    }
  }, []);
  useEffect(() => {
    if (auth === "in") loadHistory();
  }, [auth, loadHistory]);

  // ---- Poll the running job ----
  useEffect(() => {
    if (!job || job.status !== "processing") return;
    let stop = false;
    const started = Date.now();
    const tick = setInterval(() => {
      // Eased estimate: approaches 95% over ~25s, completes on success.
      const t = (Date.now() - started) / 1000;
      setProgress(Math.min(95, 100 * (1 - Math.exp(-t / 9))));
    }, 300);
    const poll = async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, 1500));
        if (stop) break;
        try {
          const r = await api<{ generation: GenerationDto; credits: number }>(`/api/generations/${job.id}`);
          if (r.generation.status !== "processing") {
            setCredits(r.credits);
            setJob(r.generation);
            setProgress(100);
            if (r.generation.status === "succeeded") {
              haptic("success");
              setHistory((h) => [r.generation, ...(h ?? []).filter((g) => g.id !== r.generation.id)]);
            } else {
              haptic("error");
              setError(errorText(r.generation.error ?? "failed"));
            }
            break;
          }
        } catch (e) {
          if (e instanceof HttpError && e.status === 401) {
            setAuth("out");
            break;
          }
        }
      }
    };
    poll();
    return () => {
      stop = true;
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  // ---- Actions ----
  const pick = () => inputRef.current?.click();

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError(errorText("invalid_image"));
      return;
    }
    setError(null);
    const blob = await prepareUpload(f);
    if (blob.size > 12 * 1024 * 1024) {
      setError(errorText("image_too_large"));
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(blob);
    setPreview(URL.createObjectURL(blob));
    haptic("light");
  };

  const submit = async (input?: { file: Blob; prompt: string; preview: string }) => {
    const src = input ?? (file && preview ? { file, prompt: prompt.trim(), preview } : null);
    if (!src || !src.prompt) return;
    if (credits < cost) {
      setSheet(true);
      return;
    }
    setError(null);
    setSubmitting(true);
    haptic("light");
    try {
      const fd = new FormData();
      fd.append("image", src.file, "photo.jpg");
      fd.append("prompt", src.prompt);
      const r = await api<{ generation: GenerationDto; credits: number }>("/api/generations", { method: "POST", body: fd });
      setCredits(r.credits);
      setJobInput(src);
      setProgress(3);
      setJob(r.generation);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      const code = e instanceof HttpError ? e.code : "server_error";
      if (code === "insufficient_credits") setSheet(true);
      if (code === "unauthorized") setAuth("out");
      setError(errorText(code));
      haptic("error");
    } finally {
      setSubmitting(false);
    }
  };

  /** Use a finished result as the new starting photo. */
  const editFurther = async (g: GenerationDto) => {
    if (!g.imageUrl) return;
    try {
      const blob = await (await fetch(g.imageUrl)).blob();
      if (preview) URL.revokeObjectURL(preview);
      setFile(blob);
      setPreview(URL.createObjectURL(blob));
      setPrompt("");
      setJob(null);
      setViewer(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
      flash("Ready for the next edit");
    } catch {
      setError(errorText("network"));
    }
  };

  const save = (g: GenerationDto) => {
    if (!g.imageUrl) return;
    const slug = appName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    downloadImage(g.imageUrl, `${slug}-${g.id}.${g.imageUrl.split(".").pop()}`);
    flash("Saving image");
  };

  // ---- Render ----
  if (auth === "loading") {
    return (
      <div className="shell" aria-busy="true">
        <div className="top"><div className="brand"><span className="brand-mark" />{appName}</div></div>
        <div className="skeleton" style={{ aspectRatio: "4/3", marginTop: 4 }} />
        <div className="skeleton" style={{ height: 84, marginTop: 12 }} />
        <div className="skeleton" style={{ height: 56, marginTop: 12 }} />
      </div>
    );
  }

  if (auth === "out") {
    const href = botUsername ? `https://t.me/${botUsername}?start=web` : "https://telegram.org";
    return (
      <main className="gate">
        <div className="gate-inner">
          <span className="brand-mark" />
          <h1>{appName}</h1>
          <p>Studio-quality photo edits from a single sentence. Sign in through Telegram. No passwords, no email.</p>
          <a className="primary" href={href} style={{ width: 280 }}>Continue with Telegram</a>
        </div>
      </main>
    );
  }

  const working = job?.status === "processing";
  const canGenerate = Boolean(file) && prompt.trim().length >= 2 && !submitting;
  const showResult = job && jobInput;

  return (
    <div className="shell">
      <header className="top">
        <div className="brand"><span className="brand-mark" />{appName}</div>
        <div className="balance" aria-label={`${credits} credits`}>
          <span className="dot" />
          {credits}
          <span className="unit">credits</span>
          <button className="topup" onClick={() => setSheet(true)} aria-label="Buy credits"><IconPlus size={16} /></button>
        </div>
      </header>

      <section className="card composer">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button className={`drop ${preview ? "has" : ""}`} onClick={pick} aria-label={preview ? "Change photo" : "Upload photo"}>
          {preview ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="preview" src={preview} alt="Your photo" />
              <span className="chip-btn"><IconUpload size={15} />Change</span>
            </>
          ) : (
            <span className="drop-cta">
              <span className="drop-icon"><IconUpload size={26} /></span>
              <span className="drop-title">Upload photo</span>
              <span className="drop-sub">JPG, PNG or HEIC · up to 12 MB</span>
            </span>
          )}
        </button>

        <textarea
          className="prompt"
          placeholder="Describe the edit…"
          value={prompt}
          maxLength={1000}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canGenerate) submit();
          }}
          enterKeyHint="go"
          aria-label="Describe the edit"
        />
        {!prompt && (
          <div className="ideas" aria-label="Ideas">
            {IDEAS.map((i) => (
              <button key={i} className="idea" onClick={() => setPrompt(i)}>{i}</button>
            ))}
          </div>
        )}

        <button className="primary" disabled={!canGenerate} onClick={() => submit()}>
          {submitting ? <span className="spinner" /> : <IconSparkle />}
          {credits < cost && file ? "Top up to generate" : "Generate"}
          <span className="cost">· {cost} credit</span>
        </button>
      </section>

      {error && (
        <div className="error-box" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss"><IconClose size={16} /></button>
        </div>
      )}

      {showResult && (
        <section className="card result" ref={resultRef} aria-live="polite">
          <div
            className={`result-media ${working ? "working" : ""}`}
            onPointerDown={() => job.status === "succeeded" && setComparing(true)}
            onPointerUp={() => setComparing(false)}
            onPointerLeave={() => setComparing(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={job.status === "succeeded" && job.imageUrl && !comparing ? job.imageUrl : jobInput.preview}
              alt={job.status === "succeeded" ? "Edited result" : "Original"}
            />
            {working && (
              <>
                <div className="shimmer" />
                <div className="working-label">Editing your photo…</div>
                <div className="progress"><i style={{ width: `${progress}%` }} /></div>
              </>
            )}
            {job.status === "succeeded" && (
              <span className="chip-btn compare-hint" style={{ right: "auto" }}>{comparing ? "Original" : "Hold to compare"}</span>
            )}
          </div>
          {job.status === "succeeded" && (
            <div className="result-bar">
              <button className="secondary" onClick={() => save(job)}><IconDownload size={18} />Save</button>
              <button className="secondary" onClick={() => submit(jobInput)} disabled={submitting}><IconRefresh size={18} />Again</button>
              <button className="secondary" onClick={() => editFurther(job)}><IconEdit size={18} />Edit</button>
            </div>
          )}
          {job.status === "failed" && (
            <div className="result-bar">
              <button className="secondary" onClick={() => submit(jobInput)} disabled={submitting}><IconRefresh size={18} />Try again</button>
            </div>
          )}
        </section>
      )}

      <div className="section-title">
        <h2>Recent</h2>
        {(() => {
          const n = history?.filter((h) => h.status === "succeeded").length ?? 0;
          return n > 0 ? <span>{n} {n === 1 ? "edit" : "edits"}</span> : null;
        })()}
      </div>
      {history === null ? (
        <div className="grid">{[0, 1, 2].map((i) => <div key={i} className="tile skeleton" />)}</div>
      ) : history.filter((h) => h.status === "succeeded").length === 0 ? (
        <div className="empty">Your edits will appear here.</div>
      ) : (
        <div className="grid">
          {history
            .filter((h) => h.status === "succeeded")
            .map((g) => (
              <button key={g.id} className="tile" onClick={() => setViewer(g)} aria-label={`Open: ${g.prompt}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.thumbUrl!} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
        </div>
      )}

      {sheet && (
        <TopUpSheet
          appName={appName}
          tokens={me?.tokens ?? []}
          onClose={() => setSheet(false)}
          onCredited={(c, added) => {
            setCredits(c);
            haptic("success");
            flash(`+${added} credits added`);
          }}
        />
      )}
      {viewer && <Viewer item={viewer} onClose={() => setViewer(null)} onSave={save} onEdit={editFurther} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
