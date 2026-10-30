import { useState } from 'react';
import { normalizeRoomCode } from '@hexfront/shared';
import type { Session } from '@hexfront/shared';
import { loadLastSession } from '../session';

interface HomeProps {
  busy: boolean;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onResume: (session: Session) => void;
}

/** Landing screen: create a game, join with a code, or resume the last one. */
export function Home({ busy, onCreate, onJoin, onResume }: HomeProps) {
  const [code, setCode] = useState('');
  const last = loadLastSession();

  return (
    <section className="home">
      <h1>HEXFRONT</h1>
      <p className="tagline">
        Stratégie tour par tour sur 127 hexagones. 13 pièces chacun, déploiement secret, 3 ordres par tour. Abattez le Général
        adverse ou tenez son QG un tour complet.
      </p>
      <div className="home-actions">
        <button className="primary big" disabled={busy} onClick={onCreate}>
          Créer une partie
        </button>
        <form
          className="join-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) onJoin(normalizeRoomCode(code));
          }}
        >
          <label htmlFor="join-code">Rejoindre avec un code</label>
          <div className="row">
            <input
              id="join-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ex. K7M2QX"
              maxLength={6}
              autoComplete="off"
              spellCheck={false}
            />
            <button disabled={busy || code.trim().length === 0}>Rejoindre</button>
          </div>
        </form>
        {last && (
          <button className="ghost" disabled={busy} onClick={() => onResume(last)}>
            Reprendre la partie {last.code}
          </button>
        )}
      </div>
    </section>
  );
}
