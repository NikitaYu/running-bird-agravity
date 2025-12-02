import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { GamePhase, GameState } from '../types';
import { audioSystem } from '../services/AudioSystem';

export type RenderStyle = 'GRID' | 'TILES';

interface GameCanvasProps {
    onUpdate: (score: number, time: number, phase: GamePhase, state: GameState, health: number, level: number) => void;
    onEvent?: (type: 'DAMAGE' | 'COLLECT' | 'BOOST') => void;
    gameState: GameState;
    setGameState: (s: GameState) => void;
    debugPhase?: GamePhase;
    debugEmptyMode?: boolean;
    renderStyle: RenderStyle;
}

export interface GameRef {
    moveLeft: () => void;
    moveRight: () => void;
    jump: () => void;
    startNewGame: () => void;
    startNextLevel: () => void;
}

// --- CONSTANTS ---
const SPEED_BASE = 16;
const JUMP_FORCE = 40;
const GRAVITY = -155;

const LANE_WIDTH = 3.0;
const SEGMENT_LENGTH = 12.0; // Multiple of LANE_WIDTH (3.0) for even grid spacing
const MAX_HEALTH = 100;
const PHASE_DURATION = 60;

// LANES
const LANE_COUNT_FLAT = 7;
const LANE_COUNT_ROUND = 12;
const ANGLE_STEP = (Math.PI * 2) / LANE_COUNT_ROUND;

const RADIUS_ROUND = 8.0;
const APOTHEM_ROUND = RADIUS_ROUND * Math.cos(ANGLE_STEP / 2);

const SQUARE_SIDE_WIDTH = 3 * LANE_WIDTH;
const RADIUS_SQUARE = SQUARE_SIDE_WIDTH / 2;

// COLORS
const C_GRID_LINE = 0x00ffff;
const C_GRID_FILL = 0x00ffff;
const C_BG = 0x05000a;
const C_HIGHLIGHT = 0xffffff;

enum ObstacleType {
    SIMPLE = 'SIMPLE',
    WALL = 'WALL',
    INSTA_DEATH = 'INSTA_DEATH',
    BULLET = 'BULLET',
    DOOR = 'DOOR',
    BALL = 'BALL',
    HEART = 'HEART',
    SPEED_BOOST = 'SPEED_BOOST',
    CLOCK_BLUE = 'CLOCK_BLUE',
    EXTRUDING = 'EXTRUDING'
}

interface ObstacleData {
    mesh: THREE.Object3D;
    type: ObstacleType;
    lane: number;
    width: number;
    exploded: boolean;
    params: {
        speed: number;
        range: number;
        offset: number;
        vertical: boolean;
        growState?: number;
        freq?: number;
        phase?: number;
    };
}

interface Particle {
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    life: number;
    maxLife: number;
}

// Helper to create text sprite for debug
function createDebugLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.Sprite();
    canvas.width = 256;
    canvas.height = 128;
    ctx.font = 'Bold 40px Arial';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 64);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.8 });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(4, 2, 1);
    return sprite;
}

// Helper: Tapered Box
function createTaperedBox(widthTop: number, widthBottom: number, height: number, material: THREE.Material): THREE.Mesh {
    const rTop = widthTop / Math.sqrt(2);
    const rBot = widthBottom / Math.sqrt(2);
    const geo = new THREE.CylinderGeometry(rTop, rBot, height, 4);
    geo.translate(0, height / 2, 0);
    geo.rotateY(Math.PI / 4);
    const m = new THREE.Mesh(geo, material);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: C_GRID_LINE })));
    return m;
}

const GameCanvas = forwardRef<GameRef, GameCanvasProps>(({ onUpdate, onEvent, gameState, setGameState, debugPhase, debugEmptyMode, renderStyle }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // THREE Core
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const reqRef = useRef<number>(0);

    // Game Logic Refs
    const worldGroupRef = useRef<THREE.Group | null>(null);
    const playerRef = useRef<THREE.Group | null>(null);
    const highlightRef = useRef<THREE.Mesh | null>(null);
    const starsRef = useRef<THREE.Points | null>(null);

    const segmentsRef = useRef<THREE.Group[]>([]);
    const obstaclesRef = useRef<ObstacleData[]>([]);
    const particlesRef = useRef<Particle[]>([]);

    // Materials Cache
    const gridLinesMatRef = useRef<THREE.LineBasicMaterial | null>(null);

    // State Refs
    const scoreRef = useRef(0);
    const timeRef = useRef(PHASE_DURATION);
    const phaseRef = useRef(GamePhase.ROUND);
    const levelRef = useRef(1);
    const healthRef = useRef(MAX_HEALTH);
    const gameStateRef = useRef(gameState);

    // Physics & Lane Logic
    const currentLane = useRef(0);
    const visualHighlightLane = useRef(0); // Which lane is visually highlighted
    const highlightOpacityRef = useRef(1.0); // For fade effect
    const targetLane = useRef(0);

    const playerVel = useRef(new THREE.Vector3());
    const isJumping = useRef(false);
    const speedMultRef = useRef(1.0);
    const speedTimerRef = useRef(0);
    const gameTimeRef = useRef(0);

    const currentGridX = useRef(0);
    const lastTimeRef = useRef(0);
    const lastStepTimeRef = useRef(0);

    // Effects
    const shakeIntensityRef = useRef(0);
    const gridFlashTimerRef = useRef(0);
    const baseCameraPos = useRef(new THREE.Vector3(0, 5, 18));

    // Empty Mode Logic
    const emptyModeRef = useRef(false);

    // --- CONTROLS ---
    useImperativeHandle(ref, () => ({
        moveLeft: () => changeLane(-1),
        moveRight: () => changeLane(1),
        jump: () => doJump(),
        startNewGame: () => resetGame(true),
        startNextLevel: () => nextLevel()
    }));

    // Sync Props
    useEffect(() => {
        emptyModeRef.current = !!debugEmptyMode;
        if (debugEmptyMode && obstaclesRef.current.length > 0) {
            obstaclesRef.current.forEach(obs => {
                if (obs.mesh.parent) obs.mesh.parent.remove(obs.mesh);
            });
            obstaclesRef.current = [];
        }
    }, [debugEmptyMode]);

    useEffect(() => {
        if (debugPhase && debugPhase !== phaseRef.current) {
            phaseRef.current = debugPhase;
            resetGame(false);
        }
    }, [debugPhase]);

    useEffect(() => {
        resetGame(false);
    }, [renderStyle]);

    useEffect(() => {
        gameStateRef.current = gameState;
    }, [gameState]);

    const changeLane = (dir: number) => {
        let next = targetLane.current + dir;

        if (phaseRef.current === GamePhase.FLAT) {
            const max = 3;
            if (next < -max) next = -max;
            if (next > max) next = max;
        } else {
            const limit = phaseRef.current === GamePhase.ROUND ? LANE_COUNT_ROUND : 12;
            if (next < 0) next = limit - 1;
            if (next >= limit) next = 0;
        }

        targetLane.current = next;
    };

    const doJump = () => {
        if (!isJumping.current) {
            isJumping.current = true;
            playerVel.current.y = JUMP_FORCE;
            audioSystem.playJump();
        }
    };

    const nextLevel = () => {
        levelRef.current++;
        if (phaseRef.current === GamePhase.ROUND) phaseRef.current = GamePhase.TUNNEL_GLOWING;
        else if (phaseRef.current === GamePhase.TUNNEL_GLOWING) phaseRef.current = GamePhase.TUNNEL_CLEAN;
        else if (phaseRef.current === GamePhase.TUNNEL_CLEAN) phaseRef.current = GamePhase.FLAT;
        else phaseRef.current = GamePhase.ROUND;
        resetGame(false);
    };

    const resetGame = (fullReset: boolean) => {
        if (fullReset) {
            scoreRef.current = 0;
            levelRef.current = 1;
            healthRef.current = MAX_HEALTH;
            phaseRef.current = GamePhase.ROUND;
        }

        timeRef.current = PHASE_DURATION;
        targetLane.current = 0;
        currentLane.current = 0;
        visualHighlightLane.current = 0;
        highlightOpacityRef.current = 1.0;
        currentGridX.current = 0;
        playerVel.current.set(0, 0, 0);
        isJumping.current = false;
        speedMultRef.current = 1.0;
        gameTimeRef.current = 0;
        shakeIntensityRef.current = 0;
        gridFlashTimerRef.current = 0;

        if (worldGroupRef.current) {
            worldGroupRef.current.clear();
            worldGroupRef.current.rotation.set(0, 0, 0);
            worldGroupRef.current.position.set(0, 0, 0);
            segmentsRef.current = [];
            obstaclesRef.current = [];
            particlesRef.current = [];
        }
        if (playerRef.current) {
            playerRef.current.position.set(0, 0, 4);
            playerRef.current.rotation.set(0, 0, 0);
            playerRef.current.userData.jumpHeight = 0;
        }

        createHighlighter();
        // FIX: Start spawning from negative index to fill behind camera
        for (let i = -10; i < 30; i++) spawnSegment(i * SEGMENT_LENGTH);
    };

    // --- INIT ---
    useEffect(() => {
        if (!containerRef.current) {
            return;
        }

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(C_BG);
        scene.fog = new THREE.FogExp2(C_BG, 0.003);
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
        camera.position.copy(baseCameraPos.current);
        camera.lookAt(0, 0, -40); // Look towards horizon
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));

        // Ensure canvas fills the screen and is behind HUD
        renderer.domElement.style.position = 'absolute';
        renderer.domElement.style.top = '0';
        renderer.domElement.style.left = '0';
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.outline = 'none';

        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const worldGroup = new THREE.Group();
        scene.add(worldGroup);
        worldGroupRef.current = worldGroup;

        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(10, 20, 10);
        scene.add(light);
        scene.add(new THREE.AmbientLight(0xffffff, 0.6));

        gridLinesMatRef.current = new THREE.LineBasicMaterial({
            color: C_GRID_LINE,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
        });

        createPlayer(scene);
        createBackground(scene);

        reqRef.current = requestAnimationFrame(animate);

        const onResize = () => {
            if (!cameraRef.current || !rendererRef.current) return;
            rendererRef.current.setSize(window.innerWidth, window.innerHeight);
            cameraRef.current.aspect = window.innerWidth / window.innerHeight;
            cameraRef.current.updateProjectionMatrix();
        };
        window.addEventListener('resize', onResize);

        return () => {
            window.removeEventListener('resize', onResize);
            cancelAnimationFrame(reqRef.current);
            renderer.dispose();
            gridLinesMatRef.current?.dispose();

            // FIX: Only remove the specific canvas element we added
            if (containerRef.current && renderer.domElement) {
                try {
                    containerRef.current.removeChild(renderer.domElement);
                } catch (e) {
                    // Ignore if already removed
                }
            }
        };
    }, []);

    // --- PARTICLES ---
    const spawnExplosion = (pos: THREE.Vector3, color: number) => {
        if (!worldGroupRef.current) return;
        const count = 12;
        const mat = new THREE.MeshBasicMaterial({ color: color });
        const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);

        for (let i = 0; i < count; i++) {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(pos);
            mesh.position.x += (Math.random() - 0.5);
            mesh.position.y += (Math.random() - 0.5);
            mesh.position.z += (Math.random() - 0.5);

            const vel = new THREE.Vector3(
                (Math.random() - 0.5) * 15,
                (Math.random() - 0.5) * 15 + 5,
                (Math.random() - 0.5) * 15
            );

            worldGroupRef.current.add(mesh);
            particlesRef.current.push({
                mesh,
                velocity: vel,
                life: 1.0,
                maxLife: 1.0
            });
        }
    };

    // --- HELPERS ---
    const createPlayer = (scene: THREE.Scene) => {
        const g = new THREE.Group();
        g.position.set(0, 0, 4);

        const body = new THREE.Mesh(
            new THREE.ConeGeometry(0.5, 1.5, 8),
            new THREE.MeshPhongMaterial({ color: 0x00aaff, flatShading: true })
        );
        body.rotation.x = -Math.PI / 2;
        body.position.y = 0.5;
        body.name = 'body';
        g.add(body);

        const wingGeo = new THREE.BoxGeometry(1.2, 0.1, 0.6);
        wingGeo.translate(0.6, 0, 0);
        const wingMat = new THREE.MeshPhongMaterial({ color: 0x0088cc });

        const leftWing = new THREE.Mesh(wingGeo, wingMat);
        leftWing.position.set(0.3, 0.5, 0);
        leftWing.name = 'leftWing';

        const rightWing = new THREE.Mesh(wingGeo, wingMat);
        rightWing.position.set(-0.3, 0.5, 0);
        rightWing.scale.x = -1;
        rightWing.name = 'rightWing';

        g.add(leftWing);
        g.add(rightWing);

        const legGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.6);
        const legMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

        // Feet
        const footGeo = new THREE.BoxGeometry(0.2, 0.1, 0.4);
        footGeo.translate(0, -0.05, 0.15);

        const leftLegGroup = new THREE.Group();
        leftLegGroup.position.set(0.2, -0.1, 0);
        const leftLegMesh = new THREE.Mesh(legGeo, legMat);
        leftLegMesh.position.y = -0.3;
        leftLegGroup.add(leftLegMesh);
        const leftFoot = new THREE.Mesh(footGeo, legMat);
        leftFoot.position.y = -0.6;
        leftLegGroup.add(leftFoot);
        leftLegGroup.name = 'leftLeg';

        const rightLegGroup = new THREE.Group();
        rightLegGroup.position.set(-0.2, -0.1, 0);
        const rightLegMesh = new THREE.Mesh(legGeo, legMat);
        rightLegMesh.position.y = -0.3;
        rightLegGroup.add(rightLegMesh);
        const rightFoot = new THREE.Mesh(footGeo, legMat);
        rightFoot.position.y = -0.6;
        rightLegGroup.add(rightFoot);
        rightLegGroup.name = 'rightLeg';

        g.add(leftLegGroup);
        g.add(rightLegGroup);

        scene.add(g);
        playerRef.current = g;
    };

    const createBackground = (scene: THREE.Scene) => {
        const geo = new THREE.BufferGeometry();
        const pos = [];
        for (let i = 0; i < 3000; i++) {
            pos.push((Math.random() - 0.5) * 1000, (Math.random() - 0.5) * 1000, (Math.random() - 0.5) * 1000 - 200);
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, transparent: true, opacity: 0.8 });
        const pts = new THREE.Points(geo, mat);
        scene.add(pts);
        starsRef.current = pts;
    };

    const createHighlighter = () => {
        if (!worldGroupRef.current) return;
        if (highlightRef.current) {
            worldGroupRef.current.remove(highlightRef.current);
            highlightRef.current = null;
        }

        // INFINITE STRIP GEOMETRY (1000 long)
        const geo = new THREE.PlaneGeometry(1, 1000);
        const mat = new THREE.MeshBasicMaterial({
            color: C_HIGHLIGHT,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 999; // Ensure render on top of floor
        worldGroupRef.current.add(mesh);
        highlightRef.current = mesh;
        updateHighlightVisuals();
    };

    const updateHighlightVisuals = () => {
        if (!highlightRef.current) return;
        const hl = highlightRef.current;
        const tLane = visualHighlightLane.current;
        const zPos = -400; // Center Z so it extends well behind the camera (approx z=100)

        // Apply Opacity
        const mat = hl.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.4 * highlightOpacityRef.current;

        // Reset scale
        hl.scale.set(1, 1, 1);

        if (phaseRef.current === GamePhase.FLAT) {
            hl.scale.x = LANE_WIDTH;
            hl.rotation.set(-Math.PI / 2, 0, 0);
            // Inset by 0.15
            hl.position.set(tLane * LANE_WIDTH, 0.15, zPos);

        } else if (phaseRef.current === GamePhase.ROUND) {
            // Precise chord width for 12-sided polygon
            const chordWidth = 2 * RADIUS_ROUND * Math.sin(Math.PI / LANE_COUNT_ROUND);
            hl.scale.x = chordWidth;

            const theta = tLane * ANGLE_STEP;
            const apothem = APOTHEM_ROUND - 0.15; // Inset by 0.15 towards center

            const x = Math.cos(theta) * apothem;
            const y = Math.sin(theta) * apothem;

            hl.position.set(x, y, zPos);
            hl.rotation.set(0, 0, theta + Math.PI / 2);
            hl.rotateX(-Math.PI / 2);

        } else if (phaseRef.current === GamePhase.TUNNEL_GLOWING || phaseRef.current === GamePhase.TUNNEL_CLEAN) {
            const width = SQUARE_SIDE_WIDTH;
            hl.scale.x = width / 3;

            const half = RADIUS_SQUARE;
            const totalLanes = 12;
            let normalizedLane = tLane;
            while (normalizedLane < 0) normalizedLane += totalLanes;
            while (normalizedLane >= totalLanes) normalizedLane -= totalLanes;

            const side = Math.floor(normalizedLane / 3) % 4;
            const sub = normalizedLane % 3;
            const step = width / 3;

            const offset = -width / 2 + sub * step + step / 2;
            const offsetInner = 0.15; // Inset by 0.15

            let x = 0, y = 0, rz = 0;
            if (side === 0) {
                x = offset; y = -half + offsetInner; rz = 0;
            } else if (side === 1) {
                x = half - offsetInner; y = offset; rz = Math.PI / 2;
            } else if (side === 2) {
                x = -offset; y = half - offsetInner; rz = Math.PI;
            } else {
                x = -half + offsetInner; y = -offset; rz = -Math.PI / 2;
            }

            hl.position.set(x, y, zPos);
            hl.rotation.set(0, 0, rz);
            hl.rotateX(-Math.PI / 2);
        }
    };

    // --- GENERATION ---
    const spawnSegment = (zPos: number) => {
        const g = new THREE.Group();
        g.position.z = -zPos;

        const lineMat = gridLinesMatRef.current || new THREE.LineBasicMaterial({ color: C_GRID_LINE });

        let fillOpacity = 0.12;
        if (phaseRef.current === GamePhase.TUNNEL_CLEAN) fillOpacity = 0.05;

        const fillMat = new THREE.MeshBasicMaterial({
            color: C_GRID_FILL,
            transparent: true,
            opacity: fillOpacity,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        const addLines = renderStyle === 'GRID';
        const isTiles = renderStyle === 'TILES';

        // Use 0.99 for tiles to close gap, 1.0 otherwise (handled by SEGMENT_LENGTH)
        const lengthMult = isTiles ? 0.99 : 1.0;
        const widthMult = isTiles ? 0.99 : 1.0;

        if (phaseRef.current === GamePhase.FLAT) {

            if (isTiles) {
                // Render individual lanes with gaps
                const tileL = SEGMENT_LENGTH * lengthMult;
                const tileW = LANE_WIDTH * widthMult;
                const planeGeo = new THREE.PlaneGeometry(tileW, tileL);

                for (let i = 0; i < LANE_COUNT_FLAT; i++) {
                    const laneIdx = i - 3;
                    const x = laneIdx * LANE_WIDTH;
                    const m = new THREE.Mesh(planeGeo, fillMat);
                    m.rotation.x = -Math.PI / 2;
                    m.position.set(x, -0.05, SEGMENT_LENGTH / 2);
                    g.add(m);
                }
            } else {
                // GRID MODE: One large plane
                const totalWidth = LANE_COUNT_FLAT * LANE_WIDTH;
                const plane = new THREE.Mesh(new THREE.PlaneGeometry(totalWidth, SEGMENT_LENGTH), fillMat);
                plane.rotation.x = -Math.PI / 2;
                plane.position.y = -0.05;
                plane.position.z = SEGMENT_LENGTH / 2;
                g.add(plane);
            }

            if (addLines) {
                const totalWidth = LANE_COUNT_FLAT * LANE_WIDTH;
                const pts = [];
                // FIX: Remove lineY offset, match plane Y
                const lineY = -0.05;
                for (let i = 0; i <= LANE_COUNT_FLAT; i++) {
                    const x = -totalWidth / 2 + i * LANE_WIDTH;
                    pts.push(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0, SEGMENT_LENGTH));
                }
                for (let z = 0; z < SEGMENT_LENGTH - 0.1; z += LANE_WIDTH) {
                    pts.push(new THREE.Vector3(-totalWidth / 2, lineY, z), new THREE.Vector3(totalWidth / 2, lineY, z));
                }
                g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
            }

        } else if (phaseRef.current === GamePhase.ROUND) {
            // PRISM LOGIC (12 Sides)
            const segments = LANE_COUNT_ROUND;
            const chordWidth = 2 * RADIUS_ROUND * Math.sin(Math.PI / LANE_COUNT_ROUND);

            const tileW = chordWidth * widthMult;
            const tileL = SEGMENT_LENGTH * lengthMult;

            const faceGeo = new THREE.PlaneGeometry(tileW, tileL);

            for (let i = 0; i < segments; i++) {
                const theta = i * ANGLE_STEP;
                const apothem = APOTHEM_ROUND;

                const m = new THREE.Mesh(faceGeo, fillMat);

                const x = Math.cos(theta) * apothem;
                const y = Math.sin(theta) * apothem;
                m.position.set(x, y, SEGMENT_LENGTH / 2);

                m.rotation.z = theta + Math.PI / 2;
                m.rotateX(-Math.PI / 2);

                g.add(m);

                if (addLines) {
                    const edges = new THREE.EdgesGeometry(faceGeo);
                    const line = new THREE.LineSegments(edges, lineMat);
                    line.position.copy(m.position);
                    line.rotation.copy(m.rotation);
                    // FIX: Remove scale to prevent gaps
                    // line.scale.set(1.01, 1.01, 1.01);
                    g.add(line);
                }
            }

        } else if (phaseRef.current === GamePhase.TUNNEL_GLOWING || phaseRef.current === GamePhase.TUNNEL_CLEAN) {
            const width = SQUARE_SIDE_WIDTH;
            const radius = RADIUS_SQUARE;
            const isGlowing = phaseRef.current === GamePhase.TUNNEL_GLOWING;

            for (let i = 0; i < 4; i++) {
                const sideGroup = new THREE.Group();

                if (isTiles) {
                    const subW = width / 3;
                    const tileW = subW * widthMult;
                    const tileL = SEGMENT_LENGTH * lengthMult;
                    const step = width / 3;

                    for (let j = 0; j < 3; j++) {
                        const x = -width / 2 + j * step + step / 2;
                        const plane = new THREE.Mesh(new THREE.PlaneGeometry(tileW, tileL), fillMat);
                        plane.rotation.x = -Math.PI / 2;
                        plane.position.set(x, -radius, SEGMENT_LENGTH / 2);
                        sideGroup.add(plane);
                    }
                } else {
                    // Standard Plane
                    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, SEGMENT_LENGTH), fillMat);
                    plane.rotation.x = -Math.PI / 2;
                    plane.position.y = -radius;
                    plane.position.z = SEGMENT_LENGTH / 2;
                    sideGroup.add(plane);
                }

                if (addLines) {
                    const sidePts = [];
                    const step = width / 3;
                    // FIX: Remove lineOffset to fix corner gaps
                    const lineOffset = 0;
                    // Optimized loop: < 3 to avoid double drawing corners (j=3 is the start of next face)
                    for (let j = 0; j < 3; j++) {
                        const x = -width / 2 + j * step;
                        sidePts.push(new THREE.Vector3(x, -radius + lineOffset, 0), new THREE.Vector3(x, -radius + lineOffset, SEGMENT_LENGTH));
                    }
                    for (let z = 0; z < SEGMENT_LENGTH - 0.1; z += LANE_WIDTH) {
                        // Width adjusted for loop optimization
                        sidePts.push(new THREE.Vector3(-width / 2, -radius + lineOffset, z), new THREE.Vector3(width / 2, -radius + lineOffset, z));
                    }
                    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(sidePts), lineMat);
                    sideGroup.add(lines);
                }

                if (isGlowing) {
                    // FIX: Tuned glow corridor material (Additive, Low Opacity, No Depth Write)
                    const outerPlane = new THREE.Mesh(
                        new THREE.PlaneGeometry(width, SEGMENT_LENGTH),
                        new THREE.MeshBasicMaterial({
                            color: 0xaa00aa,
                            transparent: true,
                            opacity: 0.1,
                            side: THREE.DoubleSide,
                            blending: THREE.AdditiveBlending,
                            depthWrite: false
                        })
                    );
                    outerPlane.position.y = -radius - 2;
                    outerPlane.rotation.x = 0.2;
                    outerPlane.name = 'outer_glow';
                    sideGroup.add(outerPlane);
                }

                sideGroup.rotation.z = i * (Math.PI / 2);
                g.add(sideGroup);
            }
        }

        // Spawn obstacles (Skip if Empty Mode)
        if (emptyModeRef.current) {
            segmentsRef.current.push(g);
            worldGroupRef.current?.add(g);
            return;
        }

        const spawnCount = Math.random() < 0.9 ? (Math.random() < 0.5 ? 1 : 2) : 0;
        for (let k = 0; k < spawnCount; k++) {
            spawnObstacle(g);
        }

        segmentsRef.current.push(g);
        worldGroupRef.current?.add(g);
    };

    const spawnObstacle = (parent: THREE.Group) => {
        // PERMANENT EMPTY MODE CHECK
        if (emptyModeRef.current) return;

        let lane = 0;
        if (phaseRef.current === GamePhase.FLAT) {
            lane = Math.floor(Math.random() * LANE_COUNT_FLAT) - 3;
        } else {
            lane = Math.floor(Math.random() * LANE_COUNT_ROUND);
        }

        let type = ObstacleType.SIMPLE;
        const r = Math.random();
        if (r > 0.95) type = ObstacleType.HEART;
        else if (r > 0.90) type = ObstacleType.SPEED_BOOST;
        else if (r > 0.85) type = ObstacleType.CLOCK_BLUE;
        else if (r > 0.75) type = ObstacleType.BULLET;
        else if (r > 0.65) type = ObstacleType.EXTRUDING;
        else if (r > 0.55) type = ObstacleType.WALL;
        else if (r > 0.40) type = ObstacleType.DOOR;
        else if (r > 0.25) type = ObstacleType.BALL;

        const group = new THREE.Group();
        const matFill = new THREE.MeshPhongMaterial({ color: C_GRID_FILL, transparent: true, opacity: 0.65 });
        const matLine = new THREE.LineBasicMaterial({ color: C_GRID_LINE });

        // Sizing
        let obsWidth = LANE_WIDTH - 0.1;
        let obsHeight = LANE_WIDTH - 0.1;
        let obsDepth = LANE_WIDTH - 0.1;
        let collisionWidth = 1.0;

        if (phaseRef.current === GamePhase.ROUND) {
            obsWidth = (2 * RADIUS_ROUND * Math.sin(ANGLE_STEP / 2)) - 0.1;
        }

        // --- OBSTACLE MESH GENERATION ---
        if (type === ObstacleType.CLOCK_BLUE) {
            const ringGeo = new THREE.TorusGeometry(obsWidth / 3, 0.1, 8, 16);
            const matClock = new THREE.MeshPhongMaterial({ color: 0x0088ff, emissive: 0x0044aa, flatShading: true });
            const ring = new THREE.Mesh(ringGeo, matClock);

            const center = new THREE.Mesh(new THREE.CylinderGeometry(obsWidth / 3.2, obsWidth / 3.2, 0.1, 16), new THREE.MeshBasicMaterial({ color: 0x001133 }));
            center.rotation.x = Math.PI / 2;

            const hand1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }));
            hand1.position.y = 0.1;
            const hand2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }));
            hand2.rotation.z = Math.PI / 3;
            hand2.position.set(0.1, 0.05, 0);

            const clockGroup = new THREE.Group();
            clockGroup.add(ring);
            clockGroup.add(center);
            clockGroup.add(hand1);
            clockGroup.add(hand2);
            clockGroup.position.y = 1.5;
            clockGroup.name = 'clock_visual';
            group.add(clockGroup);

        } else if (type === ObstacleType.EXTRUDING) {
            const shapeType = Math.floor(Math.random() * 4);
            const subSize = obsWidth / 3;

            const addVoxel = (x: number, y: number) => {
                let voxel: THREE.Mesh;
                if (phaseRef.current === GamePhase.ROUND) {
                    voxel = createTaperedBox(subSize * 0.7, subSize, obsHeight, matFill);
                } else {
                    const geo = new THREE.BoxGeometry(subSize, obsHeight, subSize);
                    geo.translate(0, obsHeight / 2, 0);
                    voxel = new THREE.Mesh(geo, matFill);
                    voxel.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), matLine));
                }
                voxel.position.set((x - 1) * subSize, 0, (y - 1) * subSize);
                group.add(voxel);
            };

            if (shapeType === 0) { // I shape 
                addVoxel(1, 0); addVoxel(1, 1); addVoxel(1, 2);
            } else if (shapeType === 1) { // L Shape
                addVoxel(0, 0); addVoxel(0, 1); addVoxel(0, 2); addVoxel(1, 2); addVoxel(2, 2);
            } else if (shapeType === 2) { // U Shape
                addVoxel(0, 0); addVoxel(0, 1); addVoxel(0, 2); addVoxel(1, 0); addVoxel(2, 0); addVoxel(2, 1); addVoxel(2, 2);
            } else { // O Shape
                addVoxel(0, 0); addVoxel(0, 1); addVoxel(0, 2); addVoxel(1, 2); addVoxel(2, 2); addVoxel(2, 1); addVoxel(2, 0); addVoxel(1, 0);
            }

        } else if (type === ObstacleType.HEART) {
            const s = new THREE.Shape();
            s.moveTo(0, 0.3);
            s.bezierCurveTo(0.1, 0.5, 0.4, 0.5, 0.4, 0.3);
            s.bezierCurveTo(0.4, 0.1, 0.2, -0.1, 0, -0.3);
            s.bezierCurveTo(-0.2, -0.1, -0.4, 0.1, -0.4, 0.3);
            s.bezierCurveTo(-0.4, 0.5, -0.1, 0.5, 0, 0.3);
            const geo = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false });
            const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff0000 }));
            m.scale.set(3, 3, 3);
            m.position.y = 1.5;
            group.add(m);
        } else if (type === ObstacleType.SPEED_BOOST) {
            const arrowGeo = new THREE.ConeGeometry(obsWidth / 4, obsWidth / 2, 3);
            for (let k = 0; k < 3; k++) {
                const m = new THREE.Mesh(arrowGeo, new THREE.MeshPhongMaterial({
                    color: 0xffff00,
                    emissive: 0xffff00,
                    emissiveIntensity: 0.2,
                    flatShading: true
                }));
                m.rotation.x = -Math.PI / 2;
                m.position.z = (k - 1) * (obsWidth / 1.5);
                m.position.y = 0.5;
                m.name = `arrow_${k}`;
                group.add(m);
            }
        } else if (type === ObstacleType.BULLET) {
            const bodyGeo = new THREE.CylinderGeometry(0.1, 0.1, 6.0, 8);
            const m = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({
                color: 0xff0066,
                emissive: 0xff0066,
                emissiveIntensity: 2.0,
                metalness: 0.8,
                roughness: 0.2
            }));
            m.rotation.x = Math.PI / 2;
            m.position.y = 1.5;
            group.add(m);

        } else if (type === ObstacleType.BALL) {
            const geo = new THREE.SphereGeometry(obsWidth / 2 - 0.1, 16, 16);
            const m = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0xff0000, shininess: 50 }));
            m.position.y = obsWidth / 2;
            group.add(m);

        } else if (type === ObstacleType.DOOR) {
            collisionWidth = 2.0;
            const panelW = obsWidth * 1.0;
            const panelH = obsHeight * 2;
            const panelMat = new THREE.MeshPhongMaterial({ color: 0x0044aa, opacity: 0.8, transparent: true });

            let left: THREE.Mesh, right: THREE.Mesh;

            if (phaseRef.current === GamePhase.ROUND) {
                left = createTaperedBox(panelW * 0.8, panelW, panelH, panelMat);
                right = createTaperedBox(panelW * 0.8, panelW, panelH, panelMat);
                left.geometry.translate(0, -panelH / 2, 0);
                right.geometry.translate(0, -panelH / 2, 0);
            } else {
                const panelGeo = new THREE.BoxGeometry(panelW, panelH, 0.2);
                left = new THREE.Mesh(panelGeo, panelMat);
                right = new THREE.Mesh(panelGeo, panelMat);
            }

            left.position.set(-panelW / 2, panelH / 2, 0);
            left.name = 'door_left';

            right.position.set(panelW / 2, panelH / 2, 0);
            right.name = 'door_right';

            const frame = new THREE.Group();
            frame.add(left);
            frame.add(right);
            group.add(frame);

        } else if (type === ObstacleType.WALL) {
            if (phaseRef.current === GamePhase.ROUND) {
                const m = createTaperedBox(obsWidth * 0.6, obsWidth, obsHeight * 2, matFill);
                group.add(m);
            } else {
                const geo = new THREE.BoxGeometry(obsWidth, obsHeight * 2, obsDepth);
                geo.translate(0, obsHeight, 0);
                const m = new THREE.Mesh(geo, matFill);
                m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), matLine));
                group.add(m);
            }
        } else {
            // SIMPLE
            if (phaseRef.current === GamePhase.ROUND) {
                const m = createTaperedBox(obsWidth * 0.6, obsWidth, obsHeight, matFill);
                group.add(m);
            } else {
                const geo = new THREE.BoxGeometry(obsWidth, obsHeight, obsDepth);
                geo.translate(0, obsHeight / 2, 0);
                const m = new THREE.Mesh(geo, matFill);
                m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), matLine));
                group.add(m);
            }
        }

        const label = createDebugLabel(type);
        label.position.set(0, obsHeight + 2.5, 0);
        group.add(label);

        // --- POSITIONING LOGIC ---
        const tileRow = Math.floor(Math.random() * 4);
        const zPos = (tileRow * LANE_WIDTH) + (LANE_WIDTH / 2);
        group.position.z = zPos;

        if (phaseRef.current === GamePhase.FLAT) {
            group.position.x = lane * LANE_WIDTH;
            group.position.y = 0;
        } else if (phaseRef.current === GamePhase.ROUND) {
            const theta = lane * ANGLE_STEP;
            const apothem = APOTHEM_ROUND;
            group.position.set(Math.cos(theta) * apothem, Math.sin(theta) * apothem, zPos);
            group.rotation.z = theta + Math.PI / 2;
            group.position.z = zPos;

        } else if (phaseRef.current === GamePhase.TUNNEL_GLOWING || phaseRef.current === GamePhase.TUNNEL_CLEAN) {
            const width = SQUARE_SIDE_WIDTH;
            const half = RADIUS_SQUARE;
            const side = Math.floor(lane / 3);
            const sub = lane % 3;
            const step = width / 3;
            const offset = -width / 2 + (sub * step) + (step * 0.5);

            if (side === 0) { // Bottom
                group.position.set(offset, -half, zPos);
            } else if (side === 1) { // Right
                group.position.set(half, offset, zPos);
                group.rotation.z = Math.PI / 2;
            } else if (side === 2) { // Top
                group.position.set(-offset, half, zPos);
                group.rotation.z = Math.PI;
            } else { // Left
                group.position.set(-half, -offset, zPos);
                group.rotation.z = -Math.PI / 2;
            }
        }

        parent.add(group);

        obstaclesRef.current.push({
            mesh: group,
            type,
            lane,
            width: collisionWidth,
            exploded: false,
            params: {
                speed: SPEED_BASE * 2.0,
                range: 0,
                offset: 0,
                vertical: false,
                growState: 0,
                freq: 0.2 + Math.random() * 0.5,
                phase: Math.random() * Math.PI * 2
            }
        });
    };

    const animate = (time: number) => {
        reqRef.current = requestAnimationFrame(animate);

        if (rendererRef.current && sceneRef.current && cameraRef.current) {
            // Camera Juice - NERFED for smooth play

            if (playerRef.current) {
                // Dampened Y follow - minimal movement (0.02)
                const targetY = baseCameraPos.current.y + (playerRef.current.position.y * 0.1);
                cameraRef.current.position.y = THREE.MathUtils.lerp(cameraRef.current.position.y, targetY, 0.02);

                const targetX = playerRef.current.position.x * 0.5;
                cameraRef.current.position.x = THREE.MathUtils.lerp(cameraRef.current.position.x, targetX, 0.05);

            } else {
                cameraRef.current.position.y = baseCameraPos.current.y;
            }

            if (shakeIntensityRef.current > 0.01) {
                const s = shakeIntensityRef.current;
                cameraRef.current.position.add(new THREE.Vector3(
                    (Math.random() - 0.5) * s,
                    (Math.random() - 0.5) * s,
                    (Math.random() - 0.5) * s
                ));
                shakeIntensityRef.current *= 0.9;
            }

            cameraRef.current.position.z = THREE.MathUtils.lerp(cameraRef.current.position.z, baseCameraPos.current.z, 0.1);
            cameraRef.current.updateProjectionMatrix();

            if (gridFlashTimerRef.current > 0) {
                gridFlashTimerRef.current -= 0.016;
                if (gridLinesMatRef.current) gridLinesMatRef.current.color.setHex(0x00ff00);
            } else {
                if (gridLinesMatRef.current) gridLinesMatRef.current.color.setHex(C_GRID_LINE);
            }

            // rendererRef.current.setViewport(0, 0, window.innerWidth, window.innerHeight);
            // rendererRef.current.setScissor(0, 0, window.innerWidth, window.innerHeight);
            rendererRef.current.render(sceneRef.current, cameraRef.current);
        }

        if (gameStateRef.current === GameState.PAUSED) return;

        let delta = (time - lastTimeRef.current) / 1000;
        lastTimeRef.current = time;
        if (isNaN(delta) || delta > 0.1) delta = 0.1;

        const speed = speedMultRef.current;
        const dt = delta * speed;
        const moveDt = delta * speed;

        gameTimeRef.current += dt;
        const gameTime = gameTimeRef.current;

        if (speedTimerRef.current > 0) {
            speedTimerRef.current -= delta;
            if (speedTimerRef.current <= 0) speedMultRef.current = 1.0;
        }

        if (starsRef.current) {
            const pos = starsRef.current.geometry.attributes.position.array as Float32Array;
            for (let i = 2; i < pos.length; i += 3) {
                pos[i] += moveDt * 50;
                if (pos[i] > 20) pos[i] -= 400;
            }
            starsRef.current.geometry.attributes.position.needsUpdate = true;
        }

        for (let i = particlesRef.current.length - 1; i >= 0; i--) {
            const p = particlesRef.current[i];
            p.life -= delta * 2.0;
            if (p.life <= 0) {
                if (worldGroupRef.current) worldGroupRef.current.remove(p.mesh);
                particlesRef.current.splice(i, 1);
            } else {
                p.mesh.position.addScaledVector(p.velocity, delta);
                p.mesh.rotation.x += delta;
                p.mesh.rotation.y += delta;
                p.mesh.scale.setScalar(p.life);
            }
        }

        if (playerRef.current) {
            const runSpeed = 15;
            const t = gameTime * runSpeed;

            const body = playerRef.current.getObjectByName('body');
            const lWing = playerRef.current.getObjectByName('leftWing');
            const rWing = playerRef.current.getObjectByName('rightWing');
            const lLeg = playerRef.current.getObjectByName('leftLeg');
            const rLeg = playerRef.current.getObjectByName('rightLeg');

            if (isJumping.current) {
                if (lWing) lWing.rotation.set(0, 0, 0.4 + Math.sin(t * 2) * 0.2);
                if (rWing) rWing.rotation.set(0, 0, -0.4 - Math.sin(t * 2) * 0.2);
                if (lLeg) lLeg.rotation.x = 0.5;
                if (rLeg) rLeg.rotation.x = 0.5;
                if (body) body.rotation.x = -Math.PI / 2 - 0.2;
            } else {
                if (body) {
                    body.position.y = 0.5 + Math.abs(Math.sin(t)) * 0.1;
                    body.rotation.x = -Math.PI / 2;
                }
                if (lWing) lWing.rotation.set(0, Math.cos(t) * 0.5, 0);
                if (rWing) rWing.rotation.set(0, Math.cos(t) * 0.5, 0);
                if (lLeg) lLeg.rotation.x = Math.sin(t) * 0.8;
                if (rLeg) rLeg.rotation.x = Math.sin(t + Math.PI) * 0.8;

                if (Math.sin(t) > 0.95 && (gameTime - lastStepTimeRef.current > 0.2)) {
                    audioSystem.playStep();
                    lastStepTimeRef.current = gameTime;
                }
                if (Math.sin(t + Math.PI) > 0.95 && (gameTime - lastStepTimeRef.current > 0.2)) {
                    audioSystem.playStep();
                    lastStepTimeRef.current = gameTime;
                }
            }
        }

        if (gameStateRef.current === GameState.PLAYING) {
            const moveSpeed = SPEED_BASE;
            const dist = moveSpeed * moveDt;

            scoreRef.current += dist;
            timeRef.current -= delta;
            if (timeRef.current <= 0) setGameState(GameState.LEVEL_COMPLETE);

            // Loop segments
            if (segmentsRef.current.length > 0) {
                segmentsRef.current.forEach(s => {
                    s.position.z += dist;
                    // Glow Animation
                    if (phaseRef.current === GamePhase.TUNNEL_GLOWING) {
                        s.children.forEach(grp => {
                            // Find outer planes by name and oscillate
                            grp.children.forEach(mesh => {
                                if (mesh.name === 'outer_glow') {
                                    mesh.rotation.x = 0.15 + Math.sin(time * 0.002 + s.id) * 0.05;
                                }
                            });
                        });
                    }
                });

                // FIX: Increase removal threshold to > 100 to keep segments behind camera active (filling the gap)
                if (segmentsRef.current[0].position.z > 100) {
                    const rem = segmentsRef.current.shift();
                    if (rem) worldGroupRef.current?.remove(rem);
                    const last = segmentsRef.current[segmentsRef.current.length - 1];
                    if (last) spawnSegment(-last.position.z + SEGMENT_LENGTH);
                }
            }

            const playerLerpSpeed = 12 * dt;
            const tLane = targetLane.current;

            const lerpCyclic = (current: number, target: number, speed: number, max: number) => {
                let diff = target - current;
                while (diff > max / 2) diff -= max;
                while (diff < -max / 2) diff += max;
                return current + diff * speed;
            };

            if (phaseRef.current === GamePhase.FLAT) {
                currentLane.current = THREE.MathUtils.lerp(currentLane.current, tLane, playerLerpSpeed);
            } else {
                currentLane.current = lerpCyclic(currentLane.current, tLane, playerLerpSpeed, 12);
            }

            // HIGHLIGHT FADE LOGIC
            // 1. If currently highlighted lane != target, fade out
            if (visualHighlightLane.current !== tLane) {
                highlightOpacityRef.current -= dt * 5.0; // Smooth fade
                if (highlightOpacityRef.current <= 0) {
                    highlightOpacityRef.current = 0;
                    visualHighlightLane.current = tLane; // Snap
                }
            } else {
                // 2. If same lane, fade in
                if (highlightOpacityRef.current < 1.0) {
                    highlightOpacityRef.current += dt * 5.0;
                    if (highlightOpacityRef.current > 1.0) highlightOpacityRef.current = 1.0;
                }
            }

            updateHighlightVisuals();

            if (phaseRef.current === GamePhase.FLAT) {
                const tx = -targetLane.current * LANE_WIDTH;
                currentGridX.current = THREE.MathUtils.lerp(currentGridX.current, tx, 5 * dt);

                worldGroupRef.current!.position.set(currentGridX.current, 0, 0);
                worldGroupRef.current!.rotation.set(0, 0, 0);
                playerRef.current!.rotation.z = -(targetLane.current - currentLane.current) * 0.2;

            } else if (phaseRef.current === GamePhase.ROUND) {
                const targetRot = -Math.PI / 2 - (targetLane.current * ANGLE_STEP);
                let currentRot = worldGroupRef.current!.rotation.z;
                let diff = targetRot - currentRot;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                worldGroupRef.current!.rotation.z += diff * (playerLerpSpeed * 1.5);
                worldGroupRef.current!.position.set(0, APOTHEM_ROUND, 0);
                playerRef.current!.rotation.z = diff * 0.3;

            } else if (phaseRef.current === GamePhase.TUNNEL_GLOWING || phaseRef.current === GamePhase.TUNNEL_CLEAN) {
                const side = Math.floor(targetLane.current / 3);
                const subLane = targetLane.current % 3;
                const targetRot = -side * (Math.PI / 2);
                const targetX = - (subLane - 1) * LANE_WIDTH;

                let rot = worldGroupRef.current!.rotation.z;
                let diff = targetRot - rot;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;

                worldGroupRef.current!.rotation.z += diff * playerLerpSpeed;
                const curX = worldGroupRef.current!.position.x;
                worldGroupRef.current!.position.x = THREE.MathUtils.lerp(curX, targetX, playerLerpSpeed);
                worldGroupRef.current!.position.y = RADIUS_SQUARE;
                playerRef.current!.rotation.z = diff * 0.5;
            }

            if (isJumping.current) {
                if (playerRef.current!.userData.jumpHeight === undefined) playerRef.current!.userData.jumpHeight = 0;
                playerRef.current!.userData.jumpHeight += playerVel.current.y * dt;
                playerVel.current.y += GRAVITY * dt;

                if (playerRef.current!.userData.jumpHeight <= 0) {
                    playerRef.current!.userData.jumpHeight = 0;
                    isJumping.current = false;
                    playerVel.current.y = 0;
                }
            }

            const jH = playerRef.current?.userData.jumpHeight || 0;
            playerRef.current!.position.y = 0.5 + jH;

            const playerWorldPos = new THREE.Vector3();
            playerRef.current!.getWorldPosition(playerWorldPos);
            playerWorldPos.y += 0.5;

            obstaclesRef.current.forEach(obs => {
                if (obs.exploded || !obs.mesh.parent) return;

                if (obs.type === ObstacleType.SPEED_BOOST) {
                    const seqSpeed = 10.0;
                    const tSeq = gameTime * seqSpeed;
                    const activeIndex = Math.floor(tSeq) % 3;
                    for (let k = 0; k < 3; k++) {
                        const arrow = obs.mesh.getObjectByName(`arrow_${k}`) as THREE.Mesh;
                        if (arrow) {
                            const mat = arrow.material as THREE.MeshPhongMaterial;
                            const revIndex = 2 - k;
                            if (revIndex === activeIndex) mat.emissiveIntensity = 1.0;
                            else mat.emissiveIntensity = 0.2;
                        }
                    }
                }
                if (obs.type === ObstacleType.CLOCK_BLUE) {
                    const vis = obs.mesh.getObjectByName('clock_visual');
                    if (vis) {
                        const s = 1.0 + Math.sin(gameTime * 4) * 0.1;
                        vis.scale.set(s, s, s);
                    }
                }

                if (obs.type === ObstacleType.BULLET) {
                    obs.mesh.position.z += obs.params.speed * dt;
                }

                if (obs.type === ObstacleType.BALL) {
                    const freq = obs.params.freq || 0.5;
                    const phase = obs.params.phase || 0;
                    const yOff = Math.abs(Math.sin(gameTime * freq * Math.PI + phase)) * 3;
                    obs.mesh.position.y = (obs.width / 2) + yOff;
                }

                // COLLISION DETECTION
                const obsWorldPos = new THREE.Vector3();
                obs.mesh.getWorldPosition(obsWorldPos);

                // 1. Z-Distance Check
                // Player is at z=4. 
                const distZ = obsWorldPos.z - 4.0;

                if (distZ > 2.0) {
                    // Passed the player
                    if (distZ > 10) {
                        obs.exploded = true;
                        if (obs.mesh.parent) obs.mesh.parent.remove(obs.mesh);
                    }
                    return;
                }

                if (Math.abs(distZ) < 1.2) {
                    // Potential Hit
                    // 2. Lane Check
                    let pLane = Math.round(currentLane.current);
                    if (phaseRef.current === GamePhase.ROUND) {
                        if (pLane < 0) pLane += 12;
                        pLane = pLane % 12;
                    }
                    const isSameLane = pLane === obs.lane;

                    // 3. Vertical Check
                    const obsHeight = 1.5; // Avg height
                    const clearedJump = (jH > obsHeight) && !obs.params.vertical; // If vertical (like ball), harder to jump over

                    if (isSameLane && !clearedJump) {
                        // HIT!
                        if (obs.type === ObstacleType.HEART) {
                            healthRef.current = Math.min(MAX_HEALTH, healthRef.current + 20);
                            audioSystem.playCollect();
                            onEvent && onEvent('COLLECT');
                        } else if (obs.type === ObstacleType.SPEED_BOOST) {
                            scoreRef.current += 500;
                            audioSystem.playCollect();
                            onEvent && onEvent('BOOST');
                        } else if (obs.type === ObstacleType.CLOCK_BLUE) {
                            speedMultRef.current = 0.5;
                            speedTimerRef.current = 5.0;
                            audioSystem.playCollect();
                            onEvent && onEvent('COLLECT');
                        } else {
                            // DAMAGE
                            audioSystem.playCrash();
                            healthRef.current -= 20;
                            shakeIntensityRef.current = 1.0;
                            spawnExplosion(obsWorldPos, 0xff0000);
                            onEvent && onEvent('DAMAGE');
                        }

                        // Remove obstacle
                        obs.exploded = true;
                        if (obs.mesh.parent) obs.mesh.parent.remove(obs.mesh);

                        if (healthRef.current <= 0) {
                            setGameState(GameState.GAME_OVER);
                        }
                    }
                }
            });

            onUpdate(Math.floor(scoreRef.current), Math.ceil(timeRef.current), phaseRef.current, gameStateRef.current, healthRef.current, levelRef.current);
        }
    };

    return <div ref={containerRef} className="w-full h-full" />;
});

export default GameCanvas;