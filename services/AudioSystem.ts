
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private isPlaying: boolean = false;
  private schedulerInterval: number | null = null;
  
  // Sequencer State
  private currentTrackIndex: number = 0;
  private nextNoteTime: number = 0;
  private current16thNote: number = 0;
  private tempo: number = 128; // Standard Synthwave tempo
  private lookahead: number = 25.0; 
  private scheduleAheadTime: number = 0.1;

  // Effects
  private delayNode: DelayNode | null = null;
  private feedbackNode: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  // Mute states
  public isMusicMuted: boolean = false;
  public isSfxMuted: boolean = false;

  // Track Definitions
  private tracks = [
    { 
      name: "NEON OVERDRIVE",
      bass: [36,36,36,36, 39,39,39,39, 34,34,34,34, 41,41,39,39], // Driving Bass
      lead: [60,0,63,0, 67,0,63,0, 58,0,60,0, 65,63,60,0], // Arpeggio
      kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      snare:[0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0]
    },
    { 
      name: "CYBER CHASE",
      bass: [24,0,24,0, 24,0,24,27, 29,0,29,0, 29,0,27,0],
      lead: [0,0,0,0, 60,63,67,72, 0,0,0,0, 70,67,63,60],
      kick: [1,0,0,1, 1,0,0,0, 1,0,0,1, 1,0,1,0],
      snare:[0,0,1,0, 0,0,1,0, 0,0,1,0, 0,1,0,0]
    },
    { 
      name: "NIGHT RUNNER",
      bass: [31,31,31,31, 29,29,29,29, 27,27,27,27, 24,24,24,24],
      lead: [67,67,0,67, 65,65,0,65, 63,63,0,63, 60,0,63,65],
      kick: [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1], // Four on the floor
      snare:[0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0]
    }
  ];

  constructor() {
    // Lazy init
  }

  public init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Master Chain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.4;
      this.masterGain.connect(this.ctx.destination);

      // Sub-mixes
      this.musicGain = this.ctx.createGain();
      this.musicGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.connect(this.masterGain);

      // Delay Effect Setup (For Music)
      this.delayNode = this.ctx.createDelay();
      this.delayNode.delayTime.value = 0.35; // Dotted 8th-ish
      this.feedbackNode = this.ctx.createGain();
      this.feedbackNode.gain.value = 0.4;
      
      this.delayNode.connect(this.feedbackNode);
      this.feedbackNode.connect(this.delayNode);
      this.delayNode.connect(this.musicGain);
    }
  }

  public getCurrentTrackName(): string {
      return this.tracks[this.currentTrackIndex].name;
  }

  public togglePlayback() {
      if (this.isPlaying) this.pause();
      else this.resume();
  }

  public toggleMusicMute() {
      this.isMusicMuted = !this.isMusicMuted;
      if (this.musicGain) {
          this.musicGain.gain.value = this.isMusicMuted ? 0 : 1.0;
      }
      return this.isMusicMuted;
  }

  public toggleSfxMute() {
      this.isSfxMuted = !this.isSfxMuted;
      if (this.sfxGain) {
          this.sfxGain.gain.value = this.isSfxMuted ? 0 : 1.0;
      }
      return this.isSfxMuted;
  }

  public resume() {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume();
    }
    // Only start sequencer if not already running
    if (!this.isPlaying) {
        this.isPlaying = true;
        this.nextNoteTime = this.ctx!.currentTime + 0.1;
        this.schedulerInterval = window.setInterval(() => this.scheduler(), this.lookahead);
    }
  }

  public pause() {
    // Only stop the sequencer, keep context alive for SFX
    this.isPlaying = false;
    if (this.schedulerInterval) {
        clearInterval(this.schedulerInterval);
        this.schedulerInterval = null;
    }
  }

  public nextTrack() {
      this.currentTrackIndex = (this.currentTrackIndex + 1) % this.tracks.length;
  }

  public prevTrack() {
      this.currentTrackIndex = (this.currentTrackIndex - 1 + this.tracks.length) % this.tracks.length;
  }

  private scheduler() {
      while (this.nextNoteTime < this.ctx!.currentTime + this.scheduleAheadTime) {
          this.scheduleNote(this.current16thNote, this.nextNoteTime);
          this.nextNote();
      }
  }

  private nextNote() {
      const secondsPerBeat = 60.0 / this.tempo;
      this.nextNoteTime += 0.25 * secondsPerBeat;
      this.current16thNote++;
      if (this.current16thNote === 16) {
          this.current16thNote = 0;
      }
  }

  private mtof(note: number): number {
      return 440 * Math.pow(2, (note - 69) / 12);
  }

  private scheduleNote(beatNumber: number, time: number) {
      if (this.isMusicMuted || !this.ctx || !this.musicGain) return;

      const track = this.tracks[this.currentTrackIndex];

      // KICK
      if (track.kick[beatNumber]) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.frequency.setValueAtTime(150, time);
          osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);
          gain.gain.setValueAtTime(1.0, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);
          osc.connect(gain);
          gain.connect(this.musicGain);
          osc.start(time);
          osc.stop(time + 0.5);
      }

      // SNARE
      if (track.snare[beatNumber]) {
          const noise = this.ctx.createBufferSource();
          const bufferSize = this.ctx.sampleRate * 0.2;
          const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
          noise.buffer = buffer;
          
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.value = 1000;

          const gain = this.ctx.createGain();
          gain.gain.setValueAtTime(0.6, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);

          noise.connect(filter);
          filter.connect(gain);
          gain.connect(this.musicGain);
          noise.start(time);
      }

      // HI-HAT
      if (beatNumber % 2 !== 0) {
          const osc = this.ctx.createOscillator();
          osc.type = 'square'; 
          osc.frequency.setValueAtTime(800, time); 
          
          const bufferSize = this.ctx.sampleRate * 0.05;
          const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
          const noise = this.ctx.createBufferSource();
          noise.buffer = buffer;

          const filter = this.ctx.createBiquadFilter();
          filter.type = 'highpass';
          filter.frequency.value = 7000;

          const gain = this.ctx.createGain();
          gain.gain.setValueAtTime(0.1, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);

          noise.connect(filter);
          filter.connect(gain);
          gain.connect(this.musicGain);
          noise.start(time);
      }

      // BASS
      const bassNote = track.bass[beatNumber];
      if (bassNote > 0) {
          const osc = this.ctx.createOscillator();
          osc.type = 'sawtooth';
          const freq = this.mtof(bassNote);
          osc.frequency.setValueAtTime(freq, time);
          
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.Q.value = 5;
          filter.frequency.setValueAtTime(100, time);
          filter.frequency.exponentialRampToValueAtTime(1500, time + 0.1);
          filter.frequency.exponentialRampToValueAtTime(100, time + 0.3);

          const gain = this.ctx.createGain();
          gain.gain.setValueAtTime(0.6, time);
          gain.gain.linearRampToValueAtTime(0, time + 0.3);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.musicGain);
          osc.start(time);
          osc.stop(time + 0.4);
      }

      // LEAD
      const leadNote = track.lead[beatNumber];
      if (leadNote > 0) {
          const osc = this.ctx.createOscillator();
          osc.type = 'square';
          const freq = this.mtof(leadNote);
          osc.frequency.setValueAtTime(freq, time);
          osc.frequency.linearRampToValueAtTime(freq + 5, time + 0.2); 

          const gain = this.ctx.createGain();
          gain.gain.setValueAtTime(0.3, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.4);

          osc.connect(gain);
          gain.connect(this.musicGain);
          if (this.delayNode) gain.connect(this.delayNode);
          
          osc.start(time);
          osc.stop(time + 0.4);
      }
  }

  // --- SFX ---

  public playJump() {
    if (this.isSfxMuted || !this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.linearRampToValueAtTime(800, t + 0.3);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.3);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  public playCrash() {
    if (this.isSfxMuted || !this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const bufferSize = this.ctx.sampleRate * 0.5;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.8, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    noise.start(t);
  }

  public playWallCrash() {
    if (this.isSfxMuted || !this.ctx || !this.sfxGain) return;
    this.playCrash(); 
  }

  public playCollect() {
    if (this.isSfxMuted || !this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1000, t);
    osc.frequency.linearRampToValueAtTime(2000, t + 0.1);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  public playStep() {
    if (this.isSfxMuted || !this.ctx || !this.sfxGain) return;
    // Short, very low pitched noise/thud
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(10, t + 0.05);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.05);
  }
}

export const audioSystem = new AudioSystem();
