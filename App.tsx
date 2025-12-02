import React, { useState, useEffect, useRef, useMemo } from 'react';
import GameCanvas, { GameRef, RenderStyle } from './components/GameCanvas';
import { GamePhase, GameState } from './types';
import { audioSystem } from './services/AudioSystem';

// VERSION: 1.6.0 - VISUAL CLEANUP

// --- ICONS ---
const IconPlay = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
    <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
  </svg>
);

const IconPause = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
    <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" />
  </svg>
);

const IconNext = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M5.055 7.06c-1.25-.714-2.805.189-2.805 1.628v8.123c0 1.44 1.555 2.342 2.805 1.628L12 14.471v2.34c0 1.44 1.555 2.342 2.805 1.628l7.108-4.061c1.26-.72 1.26-2.536 0-3.256L14.805 7.06C13.555 6.346 12 7.25 12 8.688v2.34L5.055 7.06z" />
  </svg>
);

const IconPrev = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M18.945 7.06c1.25-.714 2.805.189 2.805 1.628v8.123c0 1.44-1.555 2.342-2.805 1.628L12 14.471v2.34c0 1.44-1.555 2.342-2.805 1.628L2.087 14.38c-1.26-.72-1.26-2.536 0-3.256L9.195 7.06c1.25-.714 2.805.189 2.805 1.628v2.34l6.945-3.968z" />
  </svg>
);

const IconMusic = ({ muted }: { muted: boolean }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 transition-all ${muted ? 'opacity-40' : 'opacity-100 drop-shadow-[0_0_5px_cyan]'}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
  </svg>
);

const IconSpeaker = ({ muted }: { muted: boolean }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-5 h-5 transition-all ${muted ? 'opacity-40' : 'opacity-100 drop-shadow-[0_0_5px_cyan]'}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
  </svg>
);

const IconArrowLeft = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-8 h-8">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);

const IconArrowRight = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-8 h-8">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);

const IconArrowUp = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-8 h-8">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
  </svg>
);

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.MENU);

  // HUD Refs (Direct DOM manipulation for performance)
  const scoreRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const healthBarRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<HTMLDivElement>(null);

  const gameRef = useRef<GameRef>(null);

  // Audio State
  const [trackName, setTrackName] = useState("THE CONSTRUCT");
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [isMusicMuted, setIsMusicMuted] = useState(false);
  const [isSfxMuted, setIsSfxMuted] = useState(false);
  const wasPlayingRef = useRef(false);

  // Debug & Modes
  const [debugPhase, setDebugPhase] = useState<GamePhase | undefined>(undefined);
  const [emptyMode, setEmptyMode] = useState(false);
  const [renderStyle, setRenderStyle] = useState<RenderStyle>('GRID');

  // Input State (Visual Feedback)
  const [activeActions, setActiveActions] = useState({ left: false, right: false, jump: false });

  // Screen Flash
  const [flashColor, setFlashColor] = useState<string | null>(null);

  // Menu Selection
  const [menuSelection, setMenuSelection] = useState(0);
  const isJumpKeyDown = useRef(false);

  const menuOptions = useMemo(() => {
    switch (gameState) {
      case GameState.MENU: return [{ label: "START RUN", action: 'start' }];
      case GameState.PAUSED: return [{ label: "RESUME", action: 'resume' }, { label: "EXIT", action: 'exit' }];
      case GameState.GAME_OVER: return [{ label: "RETRY", action: 'start' }, { label: "MENU", action: 'exit' }];
      case GameState.LEVEL_COMPLETE: return [{ label: "NEXT LEVEL", action: 'next' }, { label: "MENU", action: 'exit' }];
      default: return [];
    }
  }, [gameState]);

  // Handle Game State Changes (Pause/Resume Audio)
  useEffect(() => {
    if (gameState === GameState.PAUSED) {
      wasPlayingRef.current = isMusicPlaying;
      if (isMusicPlaying) {
        audioSystem.pause();
        setIsMusicPlaying(false);
      }
    } else if (gameState === GameState.PLAYING) {
      if (wasPlayingRef.current) {
        audioSystem.resume();
        setIsMusicPlaying(true);
        wasPlayingRef.current = false;
      }
    }
  }, [gameState]);

  // Handle Input (Keyboard + Touch mapping)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }

      const isJumpKey = e.key === ' ' || e.key === 'w' || e.key === 'ArrowUp';
      const isLeftKey = e.key === 'ArrowLeft' || e.key === 'a';
      const isRightKey = e.key === 'ArrowRight' || e.key === 'd';

      // Visual feedback update
      if (isLeftKey) setActiveActions(p => ({ ...p, left: true }));
      if (isRightKey) setActiveActions(p => ({ ...p, right: true }));
      if (isJumpKey) setActiveActions(p => ({ ...p, jump: true }));

      if (gameState === GameState.PLAYING) {
        if (isLeftKey) {
          gameRef.current?.moveLeft();
        }
        if (isRightKey) {
          gameRef.current?.moveRight();
        }

        if (isJumpKey) {
          if (!isJumpKeyDown.current) {
            isJumpKeyDown.current = true;
            gameRef.current?.jump();
          }
        }

        if (e.key === 'Escape') setGameState(GameState.PAUSED);
      } else {
        // Menu Nav
        if (e.key === 'ArrowUp') setMenuSelection(s => (s - 1 + menuOptions.length) % menuOptions.length);
        if (e.key === 'ArrowDown') setMenuSelection(s => (s + 1) % menuOptions.length);
        if (e.key === 'Enter' || e.key === ' ') handleAction(menuOptions[menuSelection]?.action);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const isJumpKey = e.key === ' ' || e.key === 'w' || e.key === 'ArrowUp';
      const isLeftKey = e.key === 'ArrowLeft' || e.key === 'a';
      const isRightKey = e.key === 'ArrowRight' || e.key === 'd';

      if (isJumpKey) {
        isJumpKeyDown.current = false;
        setActiveActions(p => ({ ...p, jump: false }));
      }
      if (isLeftKey) setActiveActions(p => ({ ...p, left: false }));
      if (isRightKey) setActiveActions(p => ({ ...p, right: false }));
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [gameState, menuOptions, menuSelection]);

  // Touch Handlers for On-Screen Controls
  const handleBtnTouchStart = (action: 'left' | 'right' | 'jump', e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault(); // Prevent ghost clicks
    setActiveActions(p => ({ ...p, [action]: true }));

    if (gameState === GameState.PLAYING) {
      if (action === 'left') gameRef.current?.moveLeft();
      if (action === 'right') gameRef.current?.moveRight();
      if (action === 'jump') gameRef.current?.jump();
    } else {
      // Menu navigation support via touch controls
      if (action === 'jump') handleAction(menuOptions[menuSelection]?.action);
    }
  };

  const handleBtnTouchEnd = (action: 'left' | 'right' | 'jump', e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    setActiveActions(p => ({ ...p, [action]: false }));
  };


  const handleAction = (action: string) => {
    if (action === 'start') {
      audioSystem.resume();
      wasPlayingRef.current = false;
      gameRef.current?.startNewGame();
      setGameState(GameState.PLAYING);
    } else if (action === 'resume') {
      setGameState(GameState.PLAYING);
    } else if (action === 'exit') {
      setGameState(GameState.MENU);
      audioSystem.pause();
      setIsMusicPlaying(false);
      wasPlayingRef.current = false;
    } else if (action === 'next') {
      gameRef.current?.startNextLevel();
      setGameState(GameState.PLAYING);
    }
  };

  // Event Flash Handler
  const handleGameEvent = (type: 'DAMAGE' | 'COLLECT' | 'BOOST') => {
    if (type === 'DAMAGE') {
      setFlashColor('rgba(255, 0, 0, 0.3)');
    } else if (type === 'COLLECT') {
      setFlashColor('rgba(0, 255, 0, 0.2)');
    } else if (type === 'BOOST') {
      setFlashColor('rgba(255, 255, 255, 0.4)');
    }
    // Auto clear after short delay handled by transition, but we need to reset state to re-trigger
    setTimeout(() => setFlashColor(null), 150);
  };

  // High-performance HUD update
  const onGameUpdate = (score: number, time: number, phase: GamePhase, state: GameState, health: number, level: number) => {
    if (scoreRef.current) scoreRef.current.innerText = score.toString().padStart(6, '0');
    if (timeRef.current) timeRef.current.innerText = time.toString();
    if (healthBarRef.current) healthBarRef.current.style.width = `${health}%`;
    if (healthBarRef.current) healthBarRef.current.className = `h-full transition-all ${health > 50 ? 'bg-green-500' : 'bg-red-500'}`;
    if (phaseRef.current) phaseRef.current.innerText = phase.replace('_', ' ');
  };

  // Music Controls
  const togglePlay = () => {
    audioSystem.togglePlayback();
    setIsMusicPlaying(p => !p);
    wasPlayingRef.current = !isMusicPlaying;
  };
  const toggleMusicMute = () => setIsMusicMuted(audioSystem.toggleMusicMute());
  const toggleSfxMute = () => setIsSfxMuted(audioSystem.toggleSfxMute());

  const nextTrack = () => {
    audioSystem.nextTrack();
    setTrackName(audioSystem.getCurrentTrackName());
  };
  const prevTrack = () => {
    audioSystem.prevTrack();
    setTrackName(audioSystem.getCurrentTrackName());
  };

  return (
    <div
      className="relative w-full h-screen bg-black overflow-hidden font-arcade text-white select-none no-select"
      tabIndex={0}
      style={{ touchAction: 'none' }}
    >
      <GameCanvas
        ref={gameRef}
        gameState={gameState}
        setGameState={setGameState}
        onUpdate={onGameUpdate}
        onEvent={handleGameEvent}
        debugPhase={debugPhase}
        debugEmptyMode={emptyMode}
        renderStyle={renderStyle}
      />

      {/* --- SCREEN FLASH OVERLAY --- */}
      <div
        className="absolute inset-0 pointer-events-none z-30 transition-colors duration-100 ease-out"
        style={{ backgroundColor: flashColor || 'transparent' }}
      />

      {/* --- HUD HEADER --- */}
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start pointer-events-none z-10">

        {/* TOP LEFT: HEALTH & SCORE */}
        <div>
          <div ref={scoreRef} className="text-2xl text-cyan-400 drop-shadow-[0_0_5px_cyan]">000000</div>
          <div className="flex items-center gap-2 mt-1">
            <div className="text-2xl">🦃</div>
            <div className="w-48 h-4 bg-gray-900 border border-white/50 relative">
              <div ref={healthBarRef} className="h-full bg-green-500 w-full" />
            </div>
          </div>
          <div ref={phaseRef} className="text-[10px] text-cyan-600 mt-1 uppercase tracking-widest opacity-80"></div>
        </div>

        {/* TOP RIGHT: VERTICAL STACK */}
        <div className="flex flex-col items-end pointer-events-auto gap-3">

          {/* TIME */}
          <div ref={timeRef} className="text-4xl font-bold text-white/90 drop-shadow-md">60</div>

          {/* MUSIC PLAYER (Compact) */}
          <div className="bg-black/50 border border-cyan-500/30 px-3 py-2 rounded-lg flex items-center gap-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-cyan-400">
              <button onClick={prevTrack} className="hover:text-white transition-colors"><IconPrev /></button>
              <button onClick={togglePlay} className="hover:text-white transition-colors">{isMusicPlaying ? <IconPause /> : <IconPlay />}</button>
              <button onClick={nextTrack} className="hover:text-white transition-colors"><IconNext /></button>
            </div>
            <div className="w-[1px] h-4 bg-white/10"></div>
            <div className="flex items-center gap-2 text-cyan-400">
              <button onClick={toggleMusicMute} className="hover:text-white transition-colors"><IconMusic muted={isMusicMuted} /></button>
              <button onClick={toggleSfxMute} className="hover:text-white transition-colors"><IconSpeaker muted={isSfxMuted} /></button>
            </div>
          </div>

          {/* LEVEL SELECT */}
          <div className="bg-black/60 border border-white/20 p-2 rounded flex flex-wrap justify-end gap-2">
            {[
              { val: GamePhase.ROUND, label: 'TUBE' },
              { val: GamePhase.TUNNEL_GLOWING, label: 'GLOW' },
              { val: GamePhase.TUNNEL_CLEAN, label: 'CLN' },
              { val: GamePhase.FLAT, label: 'GRID' },
            ].map((opt) => (
              <button
                key={opt.val}
                onClick={() => setDebugPhase(opt.val)}
                className={`text-[9px] px-2 py-1 rounded transition-colors ${debugPhase === opt.val ? 'bg-cyan-600 text-white shadow-[0_0_5px_cyan]' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* RENDER STYLE SELECT */}
          <div className="bg-black/60 border border-white/20 p-2 rounded flex flex-wrap justify-end gap-2">
            {[
              { val: 'GRID', label: 'GRID' },
              { val: 'TILES', label: 'TILES' },
            ].map((opt) => (
              <button
                key={opt.val}
                onClick={() => setRenderStyle(opt.val as RenderStyle)}
                className={`text-[9px] px-2 py-1 rounded transition-colors ${renderStyle === opt.val ? 'bg-fuchsia-600 text-white shadow-[0_0_5px_magenta]' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* EMPTY MODE */}
          <label className="flex items-center gap-2 bg-black/60 border border-white/20 p-2 rounded cursor-pointer hover:border-red-500/50 transition-colors">
            <input
              type="checkbox"
              checked={emptyMode}
              onChange={(e) => setEmptyMode(e.target.checked)}
              className="accent-red-500 w-4 h-4"
            />
            <span className="text-[9px] text-red-400 font-bold tracking-wide">EMPTY MODE</span>
          </label>

        </div>
      </div>

      {/* --- TOUCH CONTROLS (Moved to Bottom 10%) --- */}
      <div className="absolute bottom-[10%] left-1/2 -translate-x-1/2 flex gap-4 items-center z-40">

        {/* LEFT */}
        <button
          className={`w-20 h-20 rounded-full border-2 border-white flex items-center justify-center transition-all duration-75 ${activeActions.left ? 'bg-white/50 scale-105' : 'bg-white/20 text-white'}`}
          onTouchStart={(e) => handleBtnTouchStart('left', e)}
          onTouchEnd={(e) => handleBtnTouchEnd('left', e)}
          onMouseDown={(e) => handleBtnTouchStart('left', e)}
          onMouseUp={(e) => handleBtnTouchEnd('left', e)}
        >
          <IconArrowLeft />
        </button>

        {/* JUMP */}
        <button
          className={`w-20 h-20 rounded-full border-2 border-white flex items-center justify-center transition-all duration-75 ${activeActions.jump ? 'bg-white/50 scale-105' : 'bg-white/20 text-white'}`}
          onTouchStart={(e) => handleBtnTouchStart('jump', e)}
          onTouchEnd={(e) => handleBtnTouchEnd('jump', e)}
          onMouseDown={(e) => handleBtnTouchStart('jump', e)}
          onMouseUp={(e) => handleBtnTouchEnd('jump', e)}
        >
          <IconArrowUp />
        </button>

        {/* RIGHT */}
        <button
          className={`w-20 h-20 rounded-full border-2 border-white flex items-center justify-center transition-all duration-75 ${activeActions.right ? 'bg-white/50 scale-105' : 'bg-white/20 text-white'}`}
          onTouchStart={(e) => handleBtnTouchStart('right', e)}
          onTouchEnd={(e) => handleBtnTouchEnd('right', e)}
          onMouseDown={(e) => handleBtnTouchStart('right', e)}
          onMouseUp={(e) => handleBtnTouchEnd('right', e)}
        >
          <IconArrowRight />
        </button>
      </div>

      {/* MENUS */}
      {gameState !== GameState.PLAYING && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-50">
          <div className="flex flex-col gap-4 text-center">
            <h1 className="text-4xl md:text-6xl text-transparent bg-clip-text bg-gradient-to-b from-cyan-300 to-blue-600 font-bold mb-8 filter drop-shadow-[0_0_10px_cyan] px-4">
              {gameState === GameState.MENU ? "RUNNING BIRD: Escape from Startup City" : gameState.replace('_', ' ')}
            </h1>

            {menuOptions.map((opt, i) => (
              <button
                key={i}
                className={`text-2xl py-2 px-8 border-2 transition-all ${i === menuSelection ? 'border-cyan-400 bg-cyan-900/50 scale-110' : 'border-transparent text-gray-500'}`}
                onClick={() => handleAction(opt.action)}
                onMouseEnter={() => setMenuSelection(i)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;