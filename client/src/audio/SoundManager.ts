export class SoundManager {
    private ctx: AudioContext | null = null;
    private buffers: Map<string, AudioBuffer> = new Map();
    private gainNode: GainNode | null = null;
    private muted: boolean = false;
    private initialized: boolean = false;

    private readonly soundPaths = {
        shoot: '/sounds/shoot.mp3',
        explosion: '/sounds/explosion.mp3',
        item_pickup: '/sounds/item_pickup.mp3',
        flag_pickup: '/sounds/flag_pickup.mp3',
        ui_hover: '/sounds/ui_hover.mp3',
        ui_click: '/sounds/ui_click.mp3',
    };

    constructor() {
        // Load mute state from localStorage
        const savedMute = localStorage.getItem('tanktaktix_mute');
        if (savedMute === '1') {
            this.muted = true;
        }
    }

    public async init() {
        if (this.initialized) return;

        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioContextClass) {
                console.warn('Web Audio API not supported in this browser');
                return;
            }

            this.ctx = new AudioContextClass();
            this.gainNode = this.ctx.createGain();
            this.gainNode.connect(this.ctx.destination);

            this.applyMuteState();

            // Load all sounds
            const loadPromises = Object.entries(this.soundPaths).map(async ([key, path]) => {
                try {
                    const response = await fetch(path);
                    if (!response.ok) return; // Ignore missing files (404)
                    const arrayBuffer = await response.arrayBuffer();
                    const audioBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
                    this.buffers.set(key, audioBuffer);
                } catch (e) {
                    // Suppress errors entirely for missing mp3s as per user's intention
                }
            });

            await Promise.all(loadPromises);
            this.initialized = true;
        } catch (e) {
            console.warn("SoundManager initialization failed", e);
        }
    }

    public play(soundName: keyof typeof this.soundPaths, volumeScale: number = 1.0) {
        if (!this.ctx || !this.gainNode || this.muted) return;

        const buffer = this.buffers.get(soundName);
        if (!buffer) return;

        // Browsers might suspend AudioContext until user interaction
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => { });
        }

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const sourceGain = this.ctx.createGain();
        sourceGain.gain.value = volumeScale;

        source.connect(sourceGain);
        sourceGain.connect(this.gainNode);

        source.start(0);
    }

    public setMute(mute: boolean) {
        this.muted = mute;
        localStorage.setItem('tanktaktix_mute', mute ? '1' : '0');
        this.applyMuteState();
    }

    public toggleMute(): boolean {
        this.setMute(!this.muted);
        return this.muted;
    }

    public isMuted(): boolean {
        return this.muted;
    }

    private applyMuteState() {
        if (this.gainNode) {
            this.gainNode.gain.value = this.muted ? 0 : 1;
        }
    }
}

export const soundManager = new SoundManager();
