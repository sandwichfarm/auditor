import { Ingestor } from '#base/Ingestor.js';
import { Note } from '../interfaces/Note.js';

export class AuthorIngestor extends Ingestor {
  private authors: Set<string> = new Set();

  feed(note: Note): void {
    if(!this?.signal) throw new Error('Ingestor not registered with signal');
    this.authors.add(note.pubkey);
    if(this.authors.size >= this.sampleSize) {
      this.signal.emit('ingestor:abort');
    }
  }

  poop(): string[] {
    return Array.from(this.authors);
  }
}