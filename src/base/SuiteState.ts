import { EventEmitter } from "tseep";

export type ISuiteState = Map<string, any>

export class SuiteState {
    private state: ISuiteState = new Map();
    private emitter: EventEmitter;

    constructor(emitter?: EventEmitter){
        if(!emitter) return;
        this.emitter = emitter;
    }
    
    set<T>(key: string, value: T): void {
        this.state.set(key, value);
    }
    
    get<T>(key: string ): T | undefined {
        return this.state.get(key) ?? undefined;
    }
}