type P = { size?: number };
const base = (size = 20) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconUpload = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
);
export const IconPlus = ({ size }: P) => (<svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>);
export const IconClose = ({ size }: P) => (<svg {...base(size)}><path d="M18 6 6 18M6 6l12 12" /></svg>);
export const IconDownload = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 4v12M7 11l5 5 5-5" /><path d="M5 20h14" /></svg>
);
export const IconRefresh = ({ size }: P) => (
  <svg {...base(size)}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
);
export const IconSparkle = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z" /></svg>
);
export const IconEdit = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13 7 4 4" /></svg>
);
export const IconCheck = ({ size }: P) => (<svg {...base(size)}><path d="m5 12 5 5 9-10" /></svg>);
export const IconWallet = ({ size }: P) => (
  <svg {...base(size)}><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M16 13h2M3 10h18M6 6V5a2 2 0 0 1 2-2h9" /></svg>
);
