"use client";

import { useEffect, useState } from "react";
import type { PaymentDto } from "@/server/payments/service";
import { PACKS, formatUsd, perImage } from "@/lib/pricing";
import { api, postJson, HttpError, errorText } from "@/lib/client";
import { IconCheck, IconClose, IconWallet } from "./Icons";

type Props = {
  appName: string;
  tokens: string[];
  onClose: () => void;
  onCredited: (credits: number, added: number) => void;
};

export function TopUpSheet({ tokens, onClose, onCredited }: Props) {
  const [packId, setPackId] = useState(PACKS[2].id);
  const [token, setToken] = useState(tokens.includes("USDC") ? "USDC" : tokens[0] ?? "USDC");
  const [payment, setPayment] = useState<PaymentDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [history, setHistory] = useState<PaymentDto[] | null>(null);

  // Close on Escape; lock background scroll.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Poll until confirmed.
  useEffect(() => {
    if (!payment || payment.status === "confirmed") return;
    let stop = false;
    const loop = async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, 4000));
        if (stop) return;
        try {
          const r = await api<{ payment: PaymentDto; credits: number }>(`/api/payments/${payment.id}`);
          if (stop) return;
          setPayment((p) => ({ ...r.payment, qr: r.payment.qr ?? p?.qr }));
          if (r.payment.status === "confirmed") {
            onCredited(r.credits, r.payment.credits);
            return;
          }
        } catch {
          /* keep polling */
        }
      }
    };
    loop();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment?.id, payment?.status === "confirmed"]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ payment: PaymentDto }>("/api/payments", { packId, token });
      setPayment(r.payment);
    } catch (e) {
      setError(errorText(e instanceof HttpError ? e.code : "server_error"));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const openHistory = async () => {
    setHistory([]);
    try {
      setHistory((await api<{ items: PaymentDto[] }>("/api/payments")).items);
    } catch {
      setHistory([]);
    }
  };

  const pack = PACKS.find((p) => p.id === packId)!;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Buy credits">
        <div className="grabber" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <h3>{payment ? (payment.status === "confirmed" ? "Payment received" : "Complete payment") : "Buy credits"}</h3>
            <p className="sub">{payment ? `${payment.credits} credits · ${formatUsd(payment.usdCents)}` : "1 credit = 1 edit. Credits never expire."}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>

        {history ? (
          <>
            <div className="txlist">
              {history.length === 0 && <div className="empty">No payments yet.</div>}
              {history.map((p) => (
                <div className="tx" key={p.id}>
                  <div>
                    <div>{p.credits} credits</div>
                    <small>{new Date(p.createdAt).toLocaleString()} · {p.amount} {p.token}</small>
                  </div>
                  <span className={`pill ${p.status === "confirmed" ? "ok" : ""}`}>{p.status === "confirmed" ? "Paid" : p.status === "expired" ? "Expired" : "Pending"}</span>
                </div>
              ))}
            </div>
            <button className="secondary" style={{ width: "100%", marginTop: 14 }} onClick={() => setHistory(null)}>Back</button>
          </>
        ) : !payment ? (
          <>
            <div className="packs" role="radiogroup">
              {PACKS.map((p) => (
                <button key={p.id} role="radio" aria-checked={p.id === packId} className={`pack ${p.id === packId ? "on" : ""}`} onClick={() => setPackId(p.id)}>
                  <span>
                    <b>{p.credits} credits</b>
                    {p.badge && <span className="tag">{p.badge}</span>}
                    <small>{perImage(p)} per edit</small>
                  </span>
                  <span className="price">{formatUsd(p.usdCents)}</span>
                </button>
              ))}
            </div>
            {tokens.length > 1 && (
              <div className="seg" role="radiogroup" aria-label="Pay with">
                {tokens.map((t) => (
                  <button key={t} role="radio" aria-checked={t === token} className={t === token ? "on" : ""} onClick={() => setToken(t)}>{t}</button>
                ))}
              </div>
            )}
            {error && <div className="error-box" style={{ marginTop: 0, marginBottom: 12 }}>{error}</div>}
            <button className="primary" onClick={start} disabled={busy}>
              {busy ? <span className="spinner" /> : <IconWallet />}
              Pay {formatUsd(pack.usdCents)} with {token}
            </button>
            <p className="note">Paid on Solana. <button className="link" onClick={openHistory}>Payment history</button></p>
          </>
        ) : payment.status === "confirmed" ? (
          <>
            <div className="status ok" style={{ fontSize: 17 }}><IconCheck /> {payment.credits} credits added</div>
            <button className="primary" style={{ marginTop: 12 }} onClick={onClose}>Start editing</button>
          </>
        ) : (
          <>
            <div className="pay-amount">
              <div className="big">{payment.amount} {payment.token}</div>
              <div className="small">Send this exact amount on the Solana network</div>
            </div>
            <a className="primary" href={payment.payUrl} style={{ marginTop: 12, textDecoration: "none" }}>
              <IconWallet /> Open in wallet
            </a>
            <div className="kv">
              <div><div className="k">Amount</div><div className="v">{payment.amount} {payment.token}</div></div>
              <button onClick={() => copy("amount", payment.amount)}>{copied === "amount" ? "Copied" : "Copy"}</button>
            </div>
            <div className="kv">
              <div><div className="k">To address</div><div className="v">{payment.recipient}</div></div>
              <button onClick={() => copy("address", payment.recipient)}>{copied === "address" ? "Copied" : "Copy"}</button>
            </div>
            {payment.qr && (showQr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="qr" src={payment.qr} alt="Payment QR code" />
            ) : (
              <p className="note"><button className="link" onClick={() => setShowQr(true)}>Paying from another device? Show QR code</button></p>
            ))}
            <div className="status"><span className="spinner" /> Waiting for payment…</div>
            {payment.status === "expired" ? (
              <p className="note">This quote has expired. If you already sent it, it will still be credited. Otherwise <button className="link" onClick={() => setPayment(null)}>start a new payment</button>.</p>
            ) : (
              <p className="note">Credits are added automatically, usually within a few seconds of confirmation. You can close this sheet.</p>
            )}
          </>
        )}
      </div>
    </>
  );
}
