import type { Note } from '#src/nips/Nip01/interfaces';
import { EventEmitter } from 'tseep';

export abstract class Ingestor {
  protected signal?: EventEmitter;
  protected sampleSize: number = 10; 
  private _completed: boolean = false;
  
  constructor(sampleSize?: number) {
    if(sampleSize){
      this.sampleSize = sampleSize;
    }
  }
  
  abstract feed(note: Note): void;
  abstract poop(): any;

  registerSignal(signal: any): void {
    this.signal = signal;
  }

  protected complete(): void {
    this._completed = true;
  }

  async completed(): Promise<void> {
    while(!this._completed) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}