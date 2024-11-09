import { EventEmitter } from "tseep";

export class SuiteState {
    private state: Map<string, any> = new Map();
    private emitter: EventEmitter;

    constructor(emitter?: EventEmitter){
        if(!emitter) return;
        this.emitter = emitter;
    }
    
    set(key: string, value: any): void {
        this.state.set(key, value);
    }
    
    get(key: string): any {
        return this.state.get(key);
    }
}