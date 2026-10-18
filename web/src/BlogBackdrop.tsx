import { lazy, Suspense, useState, useSyncExternalStore } from 'react';

const AeroShards = lazy(() => import('./effects/AeroShards'));
function useMedia(query: string) {
  return useSyncExternalStore(callback => {
    const media = window.matchMedia(query);
    media.addEventListener('change', callback);
    return () => media.removeEventListener('change', callback);
  }, () => window.matchMedia(query).matches, () => false);
}
function StaticShards() {
  return <div className="shards-static">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ left: `${(i * 37 + 11) % 100}%`, top: `${(i * 23 + 9) % 100}%`, transform: `rotate(${i * 29}deg) scale(${.45 + (i % 5) * .2})` }}/>)}</div>;
}
export function BlogBackdrop({ theme }: { theme: 'light' | 'dark' }) {
  const [gpuFailed, setGpuFailed] = useState(false);
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  const compact = useMedia('(max-width: 600px)');
  const light = theme === 'light';
  const gpu = 'gpu' in navigator && !gpuFailed && !reducedMotion;
  return <div className="blog-backdrop" aria-hidden="true" data-effect="aero-shards" data-renderer={gpu ? 'webgpu' : 'static'}>
    <Suspense fallback={<StaticShards/>}>{gpu
      ? <AeroShards style={{ width: '100%', height: '100%' }} shardColor={light ? '#9a83bd' : '#896ABD'} accentColor="#A855F7" backgroundColor="transparent" lightMode={light} placement="full" material="glass" markers="plus" count={compact ? 650 : 1300} depthOfField={.75} vignette={.3} mouseInteraction pulseOnClick holdToGather dpr={compact ? 1 : 1.5} onError={() => setGpuFailed(true)}/>
      : <StaticShards/>}</Suspense>
  </div>;
}
