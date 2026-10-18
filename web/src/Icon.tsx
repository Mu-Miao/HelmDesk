const paths: Record<string, React.ReactNode> = {
  compass: <><circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5 5-3Z"/><path d="M12 1v2m0 18v2"/></>,
  grid: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
  list: <><path d="M8 5h13M8 12h13M8 19h13"/><path d="M3 5h.01M3 12h.01M3 19h.01"/></>,
  tool: <path d="M14 4a6 6 0 0 0-7 7L2 16a3.5 3.5 0 0 0 5 5l5-5a6 6 0 0 0 7-7l-4 4-4-4 4-4Z"/>,
  monitor: <><rect x="3" y="3" width="18" height="13" rx="1"/><path d="M12 16v5m-5 0h10"/></>,
  refresh: <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></>,
  search: <><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></>,
  arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
  chevron: <path d="m6 9 6 6 6-6"/>
  ,sun: <><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></>
  ,moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }
