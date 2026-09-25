/** A check that draws itself once (a request gets a waiting mark instead); instant under reduced motion. */
export function SuccessMark({ pending }: { pending: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className="size-20 animate-pop" aria-hidden="true">
      <circle cx="32" cy="32" r="30" className={pending ? 'fill-peach-100' : 'fill-mint-100'} />
      <path
        d={pending ? 'M32 18v16M32 44v1' : 'M20 33l8 8 17-18'}
        pathLength={1}
        strokeDasharray="1"
        className={pending ? 'animate-draw stroke-peach-700' : 'animate-draw stroke-mint-700'}
        style={{ ['--path-length' as string]: 1 }}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
