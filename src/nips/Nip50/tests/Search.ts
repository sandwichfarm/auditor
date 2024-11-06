
import { CompleteOnTypeArray, ISuiteTest, SuiteTest } from '#base/SuiteTest.js';
import { ISuite } from '#base/Suite.js';

import { INip01Filter, Note, RelayEventMessage } from '#nips/Nip01/interfaces/index.js';
import { ContentIngestor } from '../ingestors/ContentIngestor.js';

export interface Nip50Filter extends INip01Filter {
  search: string;
}

export class Search extends SuiteTest implements ISuiteTest {
  readonly slug: string = 'Search';
  contentsRecievedWithTerms: string[] = [];
  searchTermsToFilter: string[] = [];
  completeOn: CompleteOnTypeArray = ['off'];
  
  constructor(suite: ISuite) {
    super(suite);
    this.registerIngestor(new ContentIngestor());
  }

  get filters(): Nip50Filter[] {
    const filters: Nip50Filter[] = [];
    this.searchTermsToFilter = this.ingestor.poop() as string[];
    if(this.searchTermsToFilter.length > 5){
      this.searchTermsToFilter.length = 5;
    }
    for(const search of this.searchTermsToFilter){
      filters.push({ search, limit:1 });
    }
    return filters
  }

  onMessageEvent(message: RelayEventMessage){
    const note = message[2];
    this.contentsRecievedWithTerms.push(note.content);
  }

  test({behavior, conditions}) {
    conditions.toBeOk(this.searchTermsToFilter.length > 0, 'data sample size is sufficient for test');

    console.log(this.searchTermsToFilter)
    console.log(this.contentsRecievedWithTerms)

    const eventsContainedTerms = this.contentsRecievedWithTerms.every(content => {
      return this.searchTermsToFilter.some(term => {
        const regex = new RegExp(term, 'i'); 
        return regex.test(content);
      });
    });
    
    behavior.toEqual(this.contentsRecievedWithTerms.length, this.searchTermsToFilter.length, 'returned same number of events as searchTermsToFilter');
    behavior.toBeOk(eventsContainedTerms, 'returned events contain search terms');
  }
}

export default Search;