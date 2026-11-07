import { t } from './i18n.js';
import { Demo } from './pages/Demo.js';
import { Home } from './pages/Home.js';
import { Room } from './pages/Room.js';

/** A tiny pathname router: "/" is the home page, "/demo" the judge split screen and "/r/:id?t=TOKEN[&judge=1]" a deal room. */
export function App() {
  const path = window.location.pathname;
  if (path === '/' || path === '') return <Home />;
  if (/^\/demo\/?$/.test(path)) return <Demo />;
  const room = /^\/r\/([0-9A-Z]{8})\/?$/.exec(path);
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t');
  if (room && token) return <Room dealId={room[1]} token={token} judge={params.get('judge') === '1'} />;
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-stone-900">{t('en', 'app.name')}</h1>
      <p className="mt-2 text-sm text-stone-500">{t('en', 'app.notFound')}</p>
      <a className="mt-6 inline-block text-sm font-medium text-emerald-700 hover:text-emerald-800" href="/">
        {t('en', 'app.home')}
      </a>
    </main>
  );
}
