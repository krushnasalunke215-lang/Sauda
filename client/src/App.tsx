import { Home } from './pages/Home.js';
import { Room } from './pages/Room.js';

/** A tiny pathname router: "/" is the home page and "/r/:id?t=TOKEN" is a deal room. */
export function App() {
  const path = window.location.pathname;
  if (path === '/' || path === '') return <Home />;
  const room = /^\/r\/([0-9A-Z]{8})\/?$/.exec(path);
  const token = new URLSearchParams(window.location.search).get('t');
  if (room && token) return <Room dealId={room[1]} token={token} />;
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Sauda</h1>
      <p className="mt-2 text-stone-600">Page not found.</p>
      <a className="mt-4 inline-block text-emerald-700 underline" href="/">
        Home
      </a>
    </main>
  );
}
