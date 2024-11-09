import assert from 'power-assert';
import Logger from './Logger.js';
import chalk from 'chalk';

export interface IAssertWrapOptions {
  verbose?: boolean;
}

export type IExpectResults = IExpectResult[];

export type IExpectError = Record<string, string | boolean>

export type IExpectErrors = IExpectError[]

export interface IExpectResult {
  code: string;
  message: string;
  pass: boolean;
  skipped: boolean;
  error?: IExpectError;
}

export const defaultExpectResult = {
  code: "UNSET",
  message: "unset",
  pass: false,
  skipped: false
}

export class AssertWrap {
  private _result: IExpectResults = [];
  private _verbose: boolean = false;
  private _skip: boolean = false;
  private logger = new Logger('@nostrwatch/auditor:AssertWrap', {
    showTimer: false,
    showNamespace: false
  });

  constructor(options: IAssertWrapOptions = {}) {
    if(options?.verbose !== undefined) this._verbose = options.verbose;
    if(this._verbose) {
      this.logger.registerLogger('pass', 'info', chalk.green.bold)
      this.logger.registerLogger('fail', 'info', chalk.redBright.bold)
    }
  }

  set skip(skip: boolean) {
    this._skip = skip;
  }

  get skip() {
    return this._skip;
  }

  private set result(result: IExpectResult) {
    this._result.push(result);
  }

  get result(): IExpectResults {
      return this._result;
  } 

  get passed(): IExpectResults {
      return this.result.filter( result => result.pass )
  }

  get skipped(): IExpectResults {
    return this.result.filter( result => result.skipped )
  }

  get failed(): IExpectResults {
    return this.result.filter( result => !result.pass && !result.skipped )
  }

  get errors(): IExpectErrors {
    return this.failed.map( result => result.error )
  }

  get passing() {
      return this.failed.length === 0;
  }

  get passRate() {
      return Math.round((this.passed.length / (this.result.length)) * 100);
  }

  private extractErrorDetails(error: any) {
    const { generatedMessage, code, actual, expected, operator } = error;
    return { generatedMessage, code, actual, expected, operator };
  }

  private createProxy(assertionFn: (...args: any[]) => void) {
    return new Proxy((...args: any[]) => assertionFn(...args), {
      apply: (target, thisArg, argumentsList) => {
        let result: IExpectResult = defaultExpectResult;
        const message = argumentsList[argumentsList.length - 1];
        let pass = false

        if(this.skip) {
          result = { ...result, message, skipped: true };
          this.result = result;
          return;
        }

        try {
          Reflect.apply(target, thisArg, argumentsList);
          pass = true;
          result = { ...result, message, pass };
          
        } catch (error) {
          error = this.extractErrorDetails(error);
          result = { ...result, message, pass, error }; 
        }
        if(this._verbose) this.logger.custom(pass? `pass`: `fail`, `${message}`, 3);
        this.result = result;
      },
    });
  }

  toBeOk = this.createProxy((value: any, message?: string) => assert.ok(value, message));
  toEqual = this.createProxy((actual: any, expected: any, message?: string) => assert.equal(actual, expected, message));
  toNotEqual = this.createProxy((actual: any, expected: any, message?: string) => assert.notEqual(actual, expected, message));
  toBe = this.createProxy((actual: any, expected: any, message?: string) => assert.strictEqual(actual, expected, message));
  toNotBe = this.createProxy((actual: any, expected: any, message?: string) => assert.notStrictEqual(actual, expected, message));
  toDeepEqual = this.createProxy((actual: any, expected: any, message?: string) => assert.deepEqual(actual, expected, message));
  toNotDeepEqual = this.createProxy((actual: any, expected: any, message?: string) => assert.notDeepEqual(actual, expected, message));
  toDeepStrictEqual = this.createProxy((actual: any, expected: any, message?: string) => assert.deepStrictEqual(actual, expected, message));
  toNotDeepStrictEqual = this.createProxy((actual: any, expected: any, message?: string) => assert.notDeepStrictEqual(actual, expected, message));
  toThrow = this.createProxy((block: () => void, error?: any, message?: string) => assert.throws(block, error, message));
  toNotThrow = this.createProxy((block: () => void, message?: string) => assert.doesNotThrow(block, message));
  toError = this.createProxy((error: any) => assert.ifError(error));
}

export class Expect { 

  readonly keys: Array<keyof Expect> = ['conditions', 'message', 'json', 'behavior']

  conditions: AssertWrap = new AssertWrap({ verbose: true})
  message: AssertWrap = new AssertWrap({ verbose: true })
  json: AssertWrap = new AssertWrap({ verbose: true })
  behavior: AssertWrap = new AssertWrap({ verbose: true })
z
  get passed(): IExpectResults {
    return this.returnKeyAggregate('passed') as IExpectResults
  }

  get failed(): IExpectResults {
    return this.returnKeyAggregate('failed') as IExpectResults
  }

  get skipped(): IExpectResults {
    return this.returnKeyAggregate('skipped') as IExpectResults
  }

  get results(): IExpectResults {
    return this.returnKeyAggregate('result') as IExpectResults
  }

  get passrate(): number {
    return Math.round( this.passed.length / this.results.length );
  }

  get passing(): boolean {
    return this.failed.length === 0;
  }

  get errors(): IExpectErrors {
    return this.returnKeyAggregate('errors') as IExpectErrors;
  }

  evaluateConditions(skip: boolean = false): boolean {
    if(this.conditions.passing) return true;
    if(skip) this.skip(['behavior'])
  }

  private skip(keys: (keyof Expect)[] ): void {
    for(const key of keys){
      this[key].skip = true;
    }
  }

  private returnKeyAggregate(key: keyof AssertWrap): IExpectResults | IExpectErrors {
    // console.log(`returnKeyAggregate: ${key}`)
    let res = []
    for(const expectKey of this.keys){
      const arr = (this[expectKey as keyof Expect] as AssertWrap)[key]
      if(!(arr instanceof Array)) {
        console.log(`returnKeyAggregate: this[${expectKey}][${key}] is not an array`)
        continue;
      }
      res = [...res, ...arr]
    }
    return res;
  }

}