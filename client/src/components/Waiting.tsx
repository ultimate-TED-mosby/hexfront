import { useState } from 'react';
import { inviteLink } from '../session';

interface WaitingProps {
  code: string;
  onLeave: () => void;
}

/** Waiting room: shows the invitation link until the opponent joins. */
export function Waiting({ code, onLeave }: WaitingProps) {
  const link = inviteLink(code);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (http, old browser): the input is selectable by hand.
      (document.getElementById('invite-link') as HTMLInputElement | null)?.select();
    }
  };

  return (
    <section className="waiting">
      <h2>Partie créée</h2>
      <p className="code-display" aria-label="Code de la partie">
        {code}
      </p>
      <label htmlFor="invite-link">Envoyez ce lien à votre adversaire</label>
      <div className="row">
        <input id="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        <button className="primary" onClick={copy}>
          {copied ? 'Copié ✓' : 'Copier le lien'}
        </button>
      </div>
      <p className="status-line">
        <span className="pulse" aria-hidden="true" /> En attente de l’adversaire…
      </p>
      <button className="ghost" onClick={onLeave}>
        Annuler et revenir à l’accueil
      </button>
    </section>
  );
}
