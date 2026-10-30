import { armyValue, opponent } from '@hexfront/shared';
import type { RoomView } from '@hexfront/shared';
import { END_REASON } from '../labels';

interface EndOverlayProps {
  room: RoomView;
  onRematch: () => void;
  onLeave: () => void;
}

/** End-of-game screen: winner, reason, rematch vote. */
export function EndOverlay({ room, onRematch, onLeave }: EndOverlayProps) {
  const { game, you } = room;
  const title = game.winner === null ? 'Partie nulle' : game.winner === you ? 'Victoire !' : 'Défaite';
  const voted = room.rematch[you];
  const opponentVoted = room.rematch[opponent(you)];

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <div className="overlay-card">
        <h2 id="end-title" className={game.winner === you ? 'win' : game.winner ? 'lose' : ''}>
          {title}
        </h2>
        <p>{game.endReason ? END_REASON[game.endReason] : ''}</p>
        {(game.endReason === 'points' || game.endReason === 'draw') && (
          <p className="muted">
            Décompte : Bleu {armyValue(game, 'blue')} – Rouge {armyValue(game, 'red')}
          </p>
        )}
        <div className="row wrap center">
          <button className="primary big" disabled={voted} onClick={onRematch}>
            {voted ? 'En attente de l’adversaire…' : 'Rejouer'}
          </button>
          <button className="ghost" onClick={onLeave}>
            Retour à l’accueil
          </button>
        </div>
        {opponentVoted && !voted && <p className="small">Votre adversaire veut une revanche (couleurs inversées).</p>}
        {!voted && !opponentVoted && <p className="small muted">La revanche se joue avec les couleurs inversées.</p>}
      </div>
    </div>
  );
}
