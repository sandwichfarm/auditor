import path from 'path';
import { fileURLToPath } from 'url';

import Ajv from "ajv";
import { EventEmitter } from "tseep";

import type { WebSocketWrapper as WebSocket } from './WebSocketWrapper.js';
import { SchemaValidator } from "./SchemaValidator.js";
import { SuiteResulter } from "./Resulter.js";
import type { ISuiteTest, ISuiteTestResult } from "./SuiteTest.js";

import { capitalize, truncate } from '#utils/string.js';
import { Expect } from './Expect.js';
import type { INip01RelayMessage } from '#src/nips/Nip01/interfaces/INip01RelayMessage.js';

import Logger from './Logger.js';
import { SuiteState } from './SuiteState.js';
import { Ingestor } from './Ingestor.js';
import { Sampler } from './Sampler.js';

export type ISuiteSampleData = Record<string, any>;

export type INipTesterCodes = Record<string, boolean | null>

export type GenericJson = Record<string, any>

export type DynamicallyImportedNipTests = Record<string, new (suite: Suite) => ISuiteTest >

export type QualifyingMessageHandler<T> = (msg: T) => boolean;
export type MessageHandler<T> = (msg: T) => void;

export interface ISuiteResult {
  pass: boolean;
  reason: string;
  tests: Record<string, ISuiteTestResult>;
  data: Record<string, any> | null; 
}

export const defaultSuiteResult: ISuiteResult = {
  pass: false,
  reason: "",
  tests: {},
  data: null
}

export type ISuiteCodeTypes = 'behavior' | 'json' | 'message';

export interface ISuite {
  readonly slug: string;
  readonly messageValidators: Record<string, SchemaValidator<any>>;
  readonly jsonValidators: Record<string, SchemaValidator<any>>;
  // readonly jsons: string[];
  // readonly behaviors: string[];
  readonly requires: string[];

  pretest: boolean;
  testKey: string;  
  data: any;
  state: SuiteState;

  setup(): Promise<void>;
  ready(): Promise<void>;
  reset(): void;  
  test(): Promise<ISuiteResult>;

  registerIngestors(testSlug: string, ingestors: Ingestor[]): void;
  registerIngestor(testSlug: string, ingestor: Ingestor): void;
  // logCode(type: 'behavior' | 'json' | 'message', code: string, result: boolean): void;
  // getCode(type: 'behavior' | 'json' | 'message', code: string): boolean | null | undefined;  
  setupHandlers(): void;
  validateJson(key: string, json: GenericJson): void;

  // collectCodes(): Partial<ISuiteTestResult>;
  
  readonly socket: WebSocket;
}

export abstract class Suite implements ISuite {
  private readonly testsDirectory: string = './tests';
  private expect: Expect;
  private _state: SuiteState = new SuiteState();
  private logger: Logger = new Logger('@nostrwatch/auditor:Suite', {
    showTimer: false,
    showNamespace: false
  });
  private _sampler: Sampler;
  private _ingestors: Ingestor[] = [];

  public readonly slug: string = "NipXX";

  protected ajv = new Ajv();
  protected ws: WebSocket;
  protected signal: EventEmitter = new EventEmitter();
  protected result: ISuiteResult = structuredClone(defaultSuiteResult);
  protected resulter: SuiteResulter = new SuiteResulter(defaultSuiteResult);

  readonly messageValidators: Record<string, SchemaValidator<any>> = {};
  readonly jsonValidators: Record<string, SchemaValidator<any>> = {};
  // jsons: string[] = [];
  // behaviors: string[] = [];
  
  protected tests: string[] = [];
  // protected messageCodes: INipTesterCodes = {};
  // protected jsonCodes: INipTesterCodes = {};
  // protected behaviorCodes: INipTesterCodes = {};
  protected testers: Record<string, ISuiteTest> = {};
  protected _ready: boolean = false;
  protected totalEvents: number = 0;
  readonly requires: string[] = ['websocket'];

  protected _messages: Map<string, INip01RelayMessage[]> = new Map();
  testKey: string = "unset";
  pretest: boolean = false;
  data: any = {};

  constructor(ws: WebSocket, metaUrl: string) {
    this.ws = ws;
    this.testsDirectory = this._calculateFilePath(metaUrl);
    this.signal.once("SUITE:READY", () => { this._ready = true });
    this.setup()
  }

  get socket(): WebSocket {
    return this.ws;
  }

  get messages(): Map<string, INip01RelayMessage[]> {  
    return this._messages;
  }

  set messages(messages: Map<string, INip01RelayMessage[]>) {
    this._messages = messages;
  }

  get state(): SuiteState {
    return this._state;
  }

  get sampler(): Sampler {
    return this._sampler;
  }

  private set sampler(sampler: Sampler) {
    this._sampler = sampler;
  }

  get ingestors(): Ingestor[] {
    return this.sampler.ingestors
  }

  async setup(){
    this.expect = new Expect();

    const tests: DynamicallyImportedNipTests = await import(this.testsDirectory);
    for (const [key, cl] of Object.entries(tests)) {
      this.testers[key] = new cl(this);
    }
    this.signal.emit('SUITE:READY');
  }

  public async ready() {
    while(!this._ready) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  reset(){
    this.resetKey();
    // this.resetCodes();
  }

  private resetKey(){
    this.testKey = "unset";
  }

  registerIngestors(testSlug: string, ingestors: Ingestor[]) {
    if(ingestors) {
      ingestors.forEach(ingestor => {
        this.registerIngestor(testSlug, ingestor)
      });
    }
  }

  registerIngestor(testSlug: string, ingestor: Ingestor) {  
    console.log(`registering ingestor for ${testSlug}`);
    if(!this?.sampler)
      this.initSampler();
    ingestor.belongsTo = testSlug;
    this.sampler.registerIngestor(ingestor);
  }

  private initSampler(){
    if(this.socket === undefined) throw new Error('socket of Suite must be set');
    this.sampler = new Sampler(this.socket);
  }

  private toilet(){
    console.log(`flushing toilet ${this.ingestors.length}`);
    const poops: ISuiteSampleData = {};
    for(const ingestor of this.ingestors) {
      console.log('flushing poop', ingestor.parent, ingestor.poop());
      const testKey = ingestor.parent;
      poops[testKey] = ingestor.poop();
    }
    this.state.set<ISuiteSampleData>('samples', poops); 
  }

  // private resetCodes(){
  //   this.messageCodes = {};
  //   this.jsonCodes = {};
  //   this.behaviorCodes = {};
  // }

  public async test(): Promise<ISuiteResult> {
    this.logger.info(`BEGIN: ${this.slug} Suite`, 1);
    
    await this.ready();
    if(this?.sampler?.samplable) {
      await this.sampler.sample();
      this.toilet();
    }

    for(const test of Object.entries(this.testers)) {
      const [testName, suiteTest] = test;
      const results = await suiteTest.run();
      console.log(results)
      this.resulter.set('tests', testName, results);
      if(suiteTest?.data !== null) {
        this.resulter.set('data', { [testName]: suiteTest.data });
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    this.resulter.set('pass', this.evaluate()); 
    this.beforeResults();
    return this.resulter.result
  }

  protected beforeResults() {}

  evaluate() {
    const tests = this.resulter.get('tests');
    const failed = Object.values(tests).filter( test => test.pass === false);
    return failed.length === 0;
  }

  // public logCode(type: ISuiteCodeTypes, plainLanguageCode: string, result: boolean): void {
  //   const code = `${plainLanguageCode.replace(/ /g, "_").toUpperCase()}`;
  //   this[`${type}Codes`][code] = result;
  // }

  // public getCode(type: ISuiteCodeTypes, plainLanguageCode: string): boolean | null | undefined {
  //   const code = `${plainLanguageCode.replace(/ /g, "_").toUpperCase()}`;
  //   return this[`${type}Codes`]?.[code] ?? null;
  // }

  // public collectCodes(): Partial<ISuiteTestResult> {
  //   return {
  //     messageCodes: this.messageCodes,
  //     jsonCodes: this.jsonCodes,
  //     behaviorCodes: this.behaviorCodes
  //   }
  // }

  setupHandlers(): void {
    this.socket.off()
    this.socket.on('message', this.handleMessage.bind(this));
  }

  protected validateMessage(message: INip01RelayMessage): void {
    const key = message?.[0] ?? "unset"
    if(!this?.messageValidators?.[key]){
      this.logger.warn(`No validator found for message ${key}`, 2);
      return;
    }
    const isValid = this?.messageValidators?.[key]?.validate(message)
    this.expect.message.toBeOk(isValid, `message ${key} is valid: ${truncate(JSON.stringify(message))}`);
    // if(this?.messageValidators?.[key]?.validate) {
    //   this.logCode('message', key, this.messageValidators[key].validate(message));   
    // }
  }

  validateJson(key: string, json: GenericJson) {
    key = key.toUpperCase();
    this.expect.json.toBeOk(this?.jsonValidators?.[key]?.validate, `json ${key} is valid`);
    // this.logCode('json', key, this.jsonValidators[key].validate(json));
  }

  protected handleMessage<T extends Buffer>(messageBuffer: T): void {
    const message: INip01RelayMessage = JSON.parse(messageBuffer.toString());
    const key = message[0];

    this.validateMessage(message);

    const messageArr = this.messages.get(key) ?? [];
    this.messages.set(key, [...messageArr, message]);

    let suiteHandler = (this[`onMessage${capitalize(key)}` as keyof typeof this] as unknown as MessageHandler<T>)
    if (suiteHandler) {
      suiteHandler = suiteHandler.bind(this);
      suiteHandler(message as any);
    }

    const testInstance = this?.testers?.[this.testKey] as ISuiteTest;
    let qualifiedTestHandler = (testInstance[`_onMessage${capitalize(key)}` as keyof typeof testInstance] as QualifyingMessageHandler<T>)
    let resume: boolean = true;
    if (qualifiedTestHandler) {
      qualifiedTestHandler = qualifiedTestHandler.bind(testInstance);
      resume = qualifiedTestHandler(message as any);
    }

    if(resume) {
      if(this.testKey === 'unset') return 
      const testHandler = (testInstance?.[`onMessage${capitalize(key)}` as keyof typeof testInstance] as MessageHandler<T>)?.bind(testInstance);
      if (testHandler) {
        testHandler(message as any);
      }
    }
  }

  private _calculateFilePath(metaUrl: string): string {
    const baseDir = path.dirname(fileURLToPath(metaUrl));
    return path.join(baseDir, './tests/index.js');
  }
}