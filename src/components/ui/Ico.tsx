import type { ReactNode } from "react";

/** 16px line icon. Pass the <path>/<circle> children from the design's icon set. */
export function Ico({ children }: { children: ReactNode }) {
  return (
    <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IcoHome = () => <Ico><path d="M2.5 7.5 8 2.5l5.5 5M4 6.5v7h8v-7" /></Ico>;
export const IcoArrowRight = () => <Ico><path d="M3 8h10M9 4l4 4-4 4" /></Ico>;
export const IcoArrowLeft = () => <Ico><path d="M13 8H3M7 4 3 8l4 4" /></Ico>;
export const IcoChat = () => <Ico><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" /></Ico>;
export const IcoField = () => (
  <Ico>
    <circle cx="8" cy="8" r="2" /><circle cx="3" cy="3.5" r="1.3" /><circle cx="13" cy="3.5" r="1.3" />
    <circle cx="3" cy="12.5" r="1.3" /><circle cx="13" cy="12.5" r="1.3" />
    <path d="M6.4 6.8 4 4.5m5.6 2.3L12 4.5M6.4 9.2 4 11.5m5.6-2.3L12 11.5" />
  </Ico>
);
export const IcoOutput = () => <Ico><path d="M4 2h5.5L12.5 5v9h-8.5z" /><path d="M9.5 2v3h3M6 8h4.5M6 10.5h4.5" /></Ico>;
export const IcoWarn = () => <Ico><path d="M8 2 14.5 13.5h-13z" /><path d="M8 6.5v3M8 11.5v.2" /></Ico>;
export const IcoGlobe = () => <Ico><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" /></Ico>;
export const IcoCompass = () => <Ico><circle cx="8" cy="8" r="6" /><path d="M10.5 5.5 9 9l-3.5 1.5L7 7z" /></Ico>;
export const IcoSearch = () => <Ico><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></Ico>;
export const IcoPencil = () => <Ico><path d="M10.5 2.5l3 3L6 13H3v-3z" /><path d="M9 4l3 3" /></Ico>;
export const IcoPlus = () => <Ico><path d="M8 3v10M3 8h10" /></Ico>;
export const IcoClip = () => <Ico><path d="M13 7.5 8 12.5a3 3 0 0 1-4.2-4.2l5.3-5.3a2 2 0 0 1 2.8 2.8L6.6 11a1 1 0 0 1-1.4-1.4L9.5 5.3" /></Ico>;
export const IcoSend = () => <Ico><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></Ico>;
export const IcoFile = IcoOutput;
export const IcoPanels2 = () => <Ico><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M8.5 3v10" /></Ico>;
export const IcoPanels3 = () => <Ico><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M6 3v10M10 3v10" /></Ico>;
