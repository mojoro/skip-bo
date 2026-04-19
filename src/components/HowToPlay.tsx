'use client';

interface HowToPlayProps {
  open: boolean;
  onClose: () => void;
}

export default function HowToPlay({ open, onClose }: HowToPlayProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-800 text-zinc-100 rounded-lg shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center sticky top-0 bg-zinc-800 pb-2 -mt-1">
          <h2 className="text-lg font-bold">How to play Skip-Bo</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white text-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
            Goal
          </h3>
          <p className="text-sm leading-relaxed text-zinc-200">
            Be the first to empty your <strong>stock pile</strong>. Everything
            else — your hand, your discard piles, the build piles in the middle —
            is just a means to that end.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
            Your zone
          </h3>
          <ul className="text-sm leading-relaxed text-zinc-200 list-disc pl-5 space-y-1">
            <li>
              <strong>Stock pile</strong> — face-down; only the top card is
              visible. You must empty this to win.
            </li>
            <li>
              <strong>Hand</strong> — up to 5 cards refilled from the draw pile
              at the start of every turn.
            </li>
            <li>
              <strong>Discard piles</strong> — four slots next to your hand.
              Used to park cards for later and to end your turn.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
            A turn
          </h3>
          <ol className="text-sm leading-relaxed text-zinc-200 list-decimal pl-5 space-y-1">
            <li>
              Draw until your hand has 5 cards (automatic at turn start).
            </li>
            <li>
              Play as many legal cards as you can onto the four shared{' '}
              <strong>build piles</strong> in the center. Sources: stock top,
              hand, or the top of any of your discard piles.
            </li>
            <li>
              Build piles start at 1 and go up to 12. When a pile reaches 12 it
              clears back to empty and can be started again.
            </li>
            <li>
              End your turn by discarding exactly <strong>one</strong> hand card
              onto any of your four discard piles.
            </li>
          </ol>
          <p className="text-xs text-zinc-400 italic">
            You always want to play your stock top if you can — that's the only
            way you make progress toward winning.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
            Skip-Bo cards (wilds)
          </h3>
          <p className="text-sm leading-relaxed text-zinc-200">
            An <strong>SB</strong> card is wild — it plays as whatever number
            fits. In the bidirectional ruleset, playing an SB onto an empty
            build pile lets you choose whether the pile will count up or down.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
            Tactics
          </h3>
          <ul className="text-sm leading-relaxed text-zinc-200 list-disc pl-5 space-y-1">
            <li>
              Group your discard piles. Stack descending runs on a single pile
              so you can unload them in one turn later.
            </li>
            <li>
              Hold off low cards if your stock top is close — starting a build
              pile you can ride up to your stock number is how you win.
            </li>
            <li>
              Don&apos;t discard a card you could play. Every card left in hand
              is a card your opponent gets another turn to counter.
            </li>
            <li>
              Track what your opponent is stacking on their discard piles —
              their discard tops are their next available plays.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
            Winning
          </h3>
          <p className="text-sm leading-relaxed text-zinc-200">
            The moment your stock pile hits zero — whether by a single play or
            a cascade — the game ends. In partnership mode either teammate
            emptying their stock wins for the team.
          </p>
        </section>

        <div className="text-xs text-zinc-500 pt-2 border-t border-zinc-700">
          Tap the <strong>Ruleset</strong> button to see the exact numbers for
          this game (hand size, stock size, wild rules).
        </div>
      </div>
    </div>
  );
}
