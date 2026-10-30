import { allHexes, armyRoster, isInDeploymentZone } from '@hexfront/shared';
import type { Placement, PlayerId } from '@hexfront/shared';

/** A legal deployment: the roster placed on the first 13 hexes of the player's zone. */
export function defaultPlacements(color: PlayerId): Placement[] {
  const zone = allHexes().filter((h) => isInDeploymentZone(h, color));
  const ordered = color === 'blue' ? zone.reverse() : zone;
  return armyRoster(color).map((r, i) => ({ unitId: r.unitId, pos: ordered[i]! }));
}
