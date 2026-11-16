"use client";

import { useEffect } from "react";
import type { GenerationDto } from "@/server/generations";
import { IconClose, IconDownload, IconEdit } from "./Icons";

type Props = {
  item: GenerationDto;
  onClose: () => void;
  onSave: (g: GenerationDto) => void;
  onEdit: (g: GenerationDto) => void;
};

export function Viewer({ item, onClose, onSave, onEdit }: Props) {
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

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Image">
      <div className="viewer-top">
        <span style={{ fontSize: 13, opacity: 0.7 }}>{new Date(item.createdAt).toLocaleString()}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><IconClose /></button>
      </div>
      <div className="viewer-img">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.imageUrl!} alt={item.prompt} />
      </div>
      <div className="viewer-bottom">
        <p>{item.prompt}</p>
        <div className="row">
          <button className="secondary" onClick={() => onSave(item)}><IconDownload size={18} />Save</button>
          <button className="secondary" onClick={() => onEdit(item)}><IconEdit size={18} />Edit this</button>
        </div>
      </div>
    </div>
  );
}
