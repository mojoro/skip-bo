export default function SiteFooter() {
  return (
    <footer
      aria-label="Trademark attribution"
      className="fixed z-40 pointer-events-none select-none"
      style={{
        bottom: 'max(0.375rem, env(safe-area-inset-bottom))',
        right: 'max(0.375rem, env(safe-area-inset-right))',
      }}
    >
      <div className="pointer-events-auto rounded-full bg-black/45 backdrop-blur-sm px-2.5 py-1 text-[10px] leading-tight text-white/55 max-w-[92vw] text-right">
        Skip-Bo® is a trademark of Mattel · unofficial fan project ·{' '}
        <a
          href="https://github.com/mojoro/skip-bo"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-white/25 hover:text-white/85"
        >
          source
        </a>
      </div>
    </footer>
  );
}
