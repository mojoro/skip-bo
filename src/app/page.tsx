import Link from 'next/link';

export default function Landing() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="space-y-4 text-center">
        <h1 className="text-2xl">Skip-Bo</h1>
        <p><Link className="underline" href="/local">Play hot-seat (local)</Link></p>
      </div>
    </main>
  );
}
