// Screen router: home → waiting room → deployment → game (+ end overlay).
import type { ReactNode } from 'react';
import { Deployment } from './components/Deployment';
import { Game } from './components/Game';
import { Home } from './components/Home';
import { Waiting } from './components/Waiting';
import { loadTabSession, loadLastSession } from './session';
import { useRoom } from './useRoom';

export function App() {
  const api = useRoom();
  const { status, room } = api;

  let screen: ReactNode;
  if (status === 'connecting' || (status === 'in-room' && !room)) {
    screen = <p className="center-msg">Connexion au serveur…</p>;
  } else if (status === 'kicked') {
    const session = loadTabSession() ?? loadLastSession();
    screen = (
      <section className="waiting">
        <h2>Partie ouverte ailleurs</h2>
        <p>Cette partie a été reprise dans un autre onglet ou un autre navigateur.</p>
        <div className="row wrap center">
          {session && (
            <button className="primary" onClick={() => void api.resume(session)}>
              Reprendre ici
            </button>
          )}
          <button className="ghost" onClick={api.leave}>
            Accueil
          </button>
        </div>
      </section>
    );
  } else if (status === 'home' || status === 'joining' || !room) {
    screen = (
      <Home
        busy={status === 'joining' || !api.connected}
        onCreate={() => void api.create()}
        onJoin={(code) => void api.join(code)}
        onResume={async (s) => {
          if (!(await api.resume(s))) api.leave();
        }}
      />
    );
  } else if (!room.seats.blue.joined || !room.seats.red.joined) {
    screen = <Waiting code={room.code} onLeave={api.leave} />;
  } else if (room.game.phase === 'deployment') {
    screen = <Deployment key={`${room.code}-${room.you}`} room={room} onReady={api.deploy} />;
  } else {
    screen = <Game room={room} onAction={api.act} onRematch={() => void api.rematch()} onLeave={api.leave} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">HEXFRONT</span>
        {room && status === 'in-room' && <span className="room-code">Partie {room.code}</span>}
      </header>
      {!api.connected && status !== 'connecting' && (
        <div className="banner warn" role="status">
          Connexion perdue, reconnexion en cours…
        </div>
      )}
      {api.error && (
        <div className="banner error" role="alert">
          {api.error}
          <button className="link" onClick={api.clearError} aria-label="Fermer le message">
            ✕
          </button>
        </div>
      )}
      <main>{screen}</main>
    </div>
  );
}
