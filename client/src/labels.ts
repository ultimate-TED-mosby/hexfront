// French UI texts shared by several components.
import type { ActionType, EndReason, PlayerId } from '@hexfront/shared';

export const COLOR_NAME: Record<PlayerId, string> = { blue: 'Bleu', red: 'Rouge' };

export const ACTION_LABEL: Record<ActionType, string> = {
  move: 'Déplacer',
  attack: 'Attaquer',
  charge: 'Charge',
  fireball: 'Boule de feu',
  trap: 'Piège',
  heal: 'Soigner',
  aidStation: 'Poste de secours',
  banner: 'Bannière',
  entrench: 'Se retrancher',
  overwatch: 'Tir de couverture',
  rally: 'Ralliement',
  endTurn: 'Fin de tour',
};

export const ACTION_HELP: Partial<Record<ActionType, string>> = {
  move: 'Choisissez une case bleue. Entrer à côté d’un ennemi arrête le déplacement.',
  attack: 'Choisissez une cible rouge.',
  charge: '2–3 cases en ligne droite puis attaque à +1. Choisissez la case d’arrivée.',
  fireball: '2 dégâts au centre, 1 autour (alliés compris), laisse du feu 2 tours.',
  trap: 'Piège visible sur une case adjacente vide : stoppe et inflige 2 dégâts.',
  heal: '+2 PV à vous-même ou un allié adjacent (trousse limitée).',
  aidStation: '+1 PV aux alliés qui commencent leur tour dessus, pendant 2 tours.',
  banner: '+1 ATQ aux alliés sur la case et autour, jusqu’à votre prochain tour.',
  entrench: '+1 armure jusqu’à votre prochain tour. La pièce ne peut plus agir ce tour.',
  overwatch: 'Tire (2 dégâts) sur le premier ennemi qui entre à portée pendant le tour adverse.',
  rally: 'Une fois par partie : +1 action ce tour (gratuit).',
};

/** Actions resolved immediately by a button, without choosing a hex. */
export const INSTANT_ACTIONS: ReadonlySet<ActionType> = new Set(['entrench', 'overwatch', 'rally']);

export const END_REASON: Record<EndReason, string> = {
  decapitation: 'Le Général adverse a été éliminé, sans successeur.',
  capture: 'Le QG adverse a été capturé et tenu un tour complet.',
  selfDecapitation: 'Les deux Généraux sont tombés par la même action : le joueur actif perd.',
  points: 'Limite de tours atteinte : victoire au décompte des pièces.',
  draw: 'Égalité au décompte des pièces.',
};
