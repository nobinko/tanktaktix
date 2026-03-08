export type InterpolatableState = {
    x: number;
    y: number;
    angle?: number;
};

type StateRecord = {
    state: InterpolatableState;
    timestamp: number;
};

export class StateBuffer {
    private buffer: StateRecord[] = [];

    public addState(state: InterpolatableState, timestamp: number) {
        this.buffer.push({ state, timestamp });
        // Keep only the latest 5 states to prevent memory leaks
        if (this.buffer.length > 5) {
            this.buffer.shift();
        }
    }

    public getInterpolatedState(renderTimestamp: number): InterpolatableState | null {
        if (this.buffer.length === 0) return null;
        if (this.buffer.length === 1) return this.buffer[0].state;

        // Find the two states that bracket the render timestamp
        for (let i = this.buffer.length - 2; i >= 0; i--) {
            const older = this.buffer[i];
            const newer = this.buffer[i + 1];

            if (older.timestamp <= renderTimestamp && renderTimestamp <= newer.timestamp) {
                // We found the bracket. Lerp between them!
                const totalDuration = newer.timestamp - older.timestamp;
                const passedDuration = renderTimestamp - older.timestamp;
                const progress = totalDuration > 0 ? passedDuration / totalDuration : 0;

                return this.lerpState(older.state, newer.state, progress);
            }
        }

        // If renderTimestamp is newer than the newest state, extrapolate or snap to newest
        if (renderTimestamp > this.buffer[this.buffer.length - 1].timestamp) {
            return this.buffer[this.buffer.length - 1].state;
        }

        // If renderTimestamp is older than the oldest state, snap to oldest
        return this.buffer[0].state;
    }

    private lerpState(older: InterpolatableState, newer: InterpolatableState, progress: number): InterpolatableState {
        const lerped: InterpolatableState = {
            x: older.x + (newer.x - older.x) * progress,
            y: older.y + (newer.y - older.y) * progress,
        };

        if (older.angle !== undefined && newer.angle !== undefined) {
            // Shortest path angle interpolation
            let angleDiff = newer.angle - older.angle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            lerped.angle = older.angle + angleDiff * progress;
        }

        return lerped;
    }
}

// Global interpolation buffers
export const interpolationBuffers = {
    players: new Map<string, StateBuffer>(),
    bullets: new Map<string, StateBuffer>(),
};

export const clearInterpolationBuffers = () => {
    interpolationBuffers.players.clear();
    interpolationBuffers.bullets.clear();
};
