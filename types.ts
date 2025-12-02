
export enum GamePhase {
  FLAT = 'FLAT',
  ROUND = 'ROUND', // Tube
  TUNNEL_GLOWING = 'TUNNEL_GLOWING', // Original Square with outer planes
  TUNNEL_CLEAN = 'TUNNEL_CLEAN' // Square without outer planes
}

export enum GameState {
  MENU = 'MENU',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  GAME_OVER = 'GAME_OVER',
  LEVEL_COMPLETE = 'LEVEL_COMPLETE'
}

export interface HudData {
  score: number;
  timeLeft: number;
  phase: GamePhase;
  health: number;
  level: number;
}
