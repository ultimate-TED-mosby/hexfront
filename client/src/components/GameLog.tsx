import { useEffect, useRef } from 'react';
import type { LogEntry } from '@hexfront/shared';

/** Scrolling game log, newest entry at the bottom. */
export function GameLog({ log }: { log: LogEntry[] }) {
  const endRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [log.length]);

  return (
    <section className="log" aria-label="Journal de la partie">
      <h3>Journal</h3>
      <ol>
        {log.map((entry, i) => (
          <li
            key={i}
            ref={i === log.length - 1 ? endRef : undefined}
            className={`${entry.player ?? 'neutral'}${entry.text.startsWith('—') ? ' turn' : ''}`}
          >
            {entry.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
