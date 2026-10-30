// Public API of the rules module (pure TypeScript, no I/O).
export * from './types.js';
export * from './hex.js';
export * from './board.js';
export * from './units.js';
export * from './queries.js';
export { reachableHexes, stopsMovement, overwatchersCovering, type Reachable } from './mechanics.js';
export { checkCapture } from './turn.js';
export { validateAction, applyAction, legalActionsForUnit, chargePath } from './actions.js';
export { createGame, validateDeployment, applyDeployment, viewForPlayer } from './game.js';
export * from './protocol.js';
