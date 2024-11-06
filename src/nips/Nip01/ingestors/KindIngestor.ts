import { Ingestor } from '#base/Ingestor.js';
import { Note } from '../interfaces/Note.js';

export class KindIngestor extends Ingestor {
  private kinds: Set<number> = new Set();

  feed(note: Note): void {
    if(!this?.signal) throw new Error('Ingestor not registered with signal');
    this.kinds.add(note.kind);
    if(this.kinds.size >= this.sampleSize) {
      this.signal.emit('ingestor:abort');
    }
  }

  poop(): number[] {
    return Array.from(this.kinds);
  }
}