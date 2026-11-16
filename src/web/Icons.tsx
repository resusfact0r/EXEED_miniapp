import type { CSSProperties } from 'react';

export function Icon({ name, size = 22, style }: { name: string; size?: number; style?: CSSProperties }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    arrow: <><path d="M4 12h15m-6-6 6 6-6 6"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    down: <path d="m6 9 6 6 6-6"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    minus: <path d="M5 12h14"/>,
    cart: <><path d="M3 4h2l2.5 12h11l2-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></>,
    car: <><path d="m4 10 2-6h12l2 6M3 10h18v8H3zM6 18v2m12-2v2M6 14h2m8 0h2"/></>,
    engine: <><path d="M3 10h3l3-4h8l3 4v8H7l-1-4H3zM11 3h6M14 3v3M22 11v6"/></>,
    body: <><path d="m3 15 2-6h3l3-4h7l3 7v5h-3m-10 0h8M8 9h10"/><circle cx="6" cy="17" r="2"/><circle cx="18" cy="17" r="2"/></>,
    suspension: <><path d="m9 3 6 3-6 3 6 3-6 3 6 3-6 3M12 1v3m0 16v3"/></>,
    brakes: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M17 5h4v9h-4zM8 6l1 2m-3 4h2m0 6 1-2"/></>,
    transmission: <><path d="M6 4v16M6 12h12V4m0 8v8"/><circle cx="6" cy="3" r="1.5"/><circle cx="18" cy="3" r="1.5"/><circle cx="6" cy="21" r="1.5"/><circle cx="18" cy="21" r="1.5"/></>,
    cooling: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 8v9m4-9v9m4-9v9M8 5V2m8 3V2"/></>,
    electric: <><path d="m13 2-8 12h6l-1 8 9-13h-7z"/></>,
    interior: <><path d="M7 3h5v10h6l2 7H6V9M4 21h17"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,
    truck: <><path d="M2 5h12v12H2zM14 10h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></>,
    shield: <><path d="m12 2 8 4v6c0 6-8 10-8 10S4 18 4 12V6z"/><path d="m8 12 3 3 5-6"/></>,
    message: <><path d="M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z"/><path d="M8 10h8m-8 4h5"/></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
    heart: <path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 2 10 8 15 6-5 12-11 8-15Z"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">{paths[name] ?? paths.car}</svg>;
}
