
import { SuiteTestResulter } from "#base/Resulter.js";
import { Sampler } from "#base/Sampler.js";
import { Ingestor } from "#base/Ingestor.js";

import type { ISuite } from "#base/Suite.js";
import { generateSubId } from "#src/utils/nostr.js";
import { ISuiteCodeTypes } from "./Suite.js";
import { WebSocketWrapper as WebSocket } from "./WebSocketWrapper.js";

import Logger from '#base/Logger.js';
import { Nip01ClientMessageGenerator } from "#src/nips/Nip01/index.js";
import { RelayEventMessage } from "#src/nips/Nip01/interfaces/RelayEventMessage.js";

import { AssertWrap, Expect, IExpectErrors, IExpectResult, IExpectResults } from "./Expect.js";

import { INip01Filter } from "#src/nips/Nip01/interfaces/Filter.js";
import { Note } from "#src/nips/Nip01/interfaces/Note.js";
import chalk from "chalk";
import { SuiteState } from "./SuiteState.js";

export type CompleteOnType = "off" | "maxEvents" | "EOSE";
export type CompleteOnTypeArray = [CompleteOnType, ...CompleteOnType[]];

export interface IExpectation {
  type: 'message' | 'json' | 'behavior';
  code: string;
  value: any;
  result: boolean;
  sample: any;
}

export interface ISuiteTest {
  slug: string;
  data: any;
  run(): any;
  _onMessageEvent(message: RelayEventMessage): boolean;
  test(methods: Expect): void;
  precheck(conditions: AssertWrap): void;  
} 

export interface ISuiteTestResult {
  testKey: string;
  passing: boolean;
  passrate: number;
  passed: IExpectResults;
  failed: IExpectResults;
  notices: string[];
  errors: IExpectErrors;
}

export const defaultSuiteTestResult: ISuiteTestResult = {
  testKey: "unset",
  passing: false,
  passrate: 0,
  passed: [],
  failed: [],
  notices: [],
  errors: []
}

export abstract class SuiteTest implements ISuiteTest {
  readonly slug: string = 'unset';
  
  private logger: Logger = new Logger('@nostrwatch/auditor', {
    showTimer: false,
    showNamespace: false
  }); 
  private _expect: Expect = new Expect();

  protected suite: ISuite;
  protected result?: ISuiteTestResult;
  protected resulter: SuiteTestResulter = new SuiteTestResulter(defaultSuiteTestResult);
  protected sampler?: Sampler;
  protected ingestor: Ingestor;

  protected subId: string = generateSubId();  

  protected notices: string[] = [];
  private timeout: ReturnType<typeof setTimeout> = null;
  protected timeoutMs: number = 10000;
  
  testParams: Record<string, any> = {};
  data: any = {};
  maxEvents: number = 20;
  totalEvents: number = 0;
  completeOn: CompleteOnTypeArray = ['maxEvents', 'EOSE'];

  constructor(suite: ISuite) {
    this.suite = suite;
    this.logger.registerLogger('pass', 'info', chalk.green.bold);
    this.logger.registerLogger('fail', 'info', chalk.redBright.bold);
  }

  get filters(): INip01Filter[] {
    return [];
  }

  get socket(): WebSocket {
    return this.suite.socket; 
  }

  get state(): SuiteState {
    return this.suite.state;
  }

  protected get expect(): Expect {
    return this._expect;
  }

  suiteIngest(ingestor: Ingestor[] | Ingestor) {
    if(Array.isArray(ingestor)) {
      this.suite.registerIngestors(ingestor);
    }
    else {
      this.suite.registerIngestor(ingestor);
    }
  }

  suiteTestIngest(ingestor: Ingestor[] | Ingestor) {
    if(Array.isArray(ingestor)) {
      this.registerIngestors(ingestor);
    }
    else {
      this.registerIngestor(ingestor);
    }
  }

  private registerIngestors(ingestors: Ingestor[]) {
    if(ingestors) {
      ingestors.forEach(ingestor => this.registerIngestor(ingestor));
    }
  }

  private registerIngestor(ingestor: Ingestor) {  
    if(!this?.sampler)
      this.initSampler();
    this.sampler.registerIngestor(ingestor);
  }

  initSampler(){
    if(this.suite.socket === undefined) throw new Error('socket of Suite must be set');
    this.sampler = new Sampler(this.suite.socket);
  }

  EVENT(event: Note) {
    this.socket.send(Nip01ClientMessageGenerator.EVENT(event));
  }

  REQ(filters: INip01Filter[]) {
    this.socket.send(Nip01ClientMessageGenerator.REQ(this.subId, filters));
  }

  CLOSE(){
    this.socket.send(Nip01ClientMessageGenerator.CLOSE(this.subId));
  }

  async testable(){
    while(this.socket.CONNECTED){
      await new Promise(resolve => setTimeout(resolve, 100));
    };
  }

  async screen(conditions: AssertWrap): Promise<void> {}

  async prepare() {
    this.REQ(this.filters)
    await this.testable();
  }

  async run() {
    this.logger.info(`BEGIN: ${this.slug}`, 2);
    
    if(this?.sampler?.samplable) {
      await this.sampler.sample();
    }

    this.suite.reset()
    this.suite.testKey = this.slug

    if(this.suite.requires.includes('websocket')) {
      await this.socket.connect();
      this.suite.setupHandlers();
      this.newSubId();
    }
    
    if(this.slug === 'unset') throw new Error('slug of SuiteTest must be set');

    this.timeoutBegin();
    await this.screen(this.expect.conditions)
    this.state.set('okConditions', this.expect.conditions.passed);
    await this.prepare();
    this.finish();
    return this.resulter.result
  }

  // public logCode(type: ISuiteCodeTypes, plainLanguageCode: string, result: boolean): void {
  //   this.suite.logCode(type, plainLanguageCode, result);
  // }

  // public getCode(type: ISuiteCodeTypes, plainLanguageCode: string): boolean | null | undefined {
  //   return this.suite.getCode(type, plainLanguageCode);
  // }

  protected newSubId() {
    this.subId = generateSubId()
  }

  protected conclude() {
    this.timeoutFinish();
    this.socket.off();
    this.socket.terminate();
  }

  timeoutBegin() {  
    this.timeout = setTimeout(() => {
      this.abort();
      this.test(this.expect);
    }, this.timeoutMs);
  }

  timeoutFinish() {
    this.logger.debug(`${this.slug} timed out`, 2);
    clearTimeout(this.timeout);
  }

  private finish(): void {
    this.logger.debug(`testKey: ${this.suite.testKey}`, 2);
    // const codes = this.suite.collectCodes();
    const { passed, failed, passing, errors } = this.expect;
    const passrate = passed.length / (passed.length + failed.length);
    const notices = this.notices;
    const result = {
      testKey: this.suite.testKey,
      passing,
      passrate,
      passed,
      failed,
      notices,
      errors
    } as ISuiteTestResult;

    this.logger.custom(passed? 'pass': 'fail', `${this.slug}`, 2);
    
    this.resulter.set(result as ISuiteTestResult);
  }

  passed(): void {

  }

  // evaluate(codes: Partial<ISuiteTestResult>): boolean {
  //   const { messageCodes, jsonCodes, behaviorCodes } = codes as ISuiteTestResult;
  
  //   const allEmpty = !Object.keys(this.expect.behavior).length && 
  //                    !Object.keys(this.expect.json).length && 
  //                    !Object.keys(this.expect.message).length
  
  //   if (allEmpty) return false;
  
  //   const messagePass = Object.values(messageCodes).every(code => code === true);
  //   const jsonPass = Object.values(jsonCodes).every(code => code === true);
  //   const behaviorPass = Object.values(behaviorCodes).every(code => code === true);
  
  //   return messagePass && jsonPass && behaviorPass;
  // }

  // reason(codes: Partial<ISuiteTestResult>): string {
  //   const { messageCodes, jsonCodes, behaviorCodes } = codes as ISuiteTestResult;
  //   const failedMessages = Object.entries(messageCodes).filter( ([_, code]) => code === false);
  //   const failedJsons = Object.entries(jsonCodes).filter( ([_, code]) => code === false);
  //   const failedBehaviors = Object.entries(behaviorCodes).filter( ([_, code]) => code === false);
  //   const failed = [...failedMessages, ...failedJsons, ...failedBehaviors];
  //   if(failed.length === 0) return 'all good 🤙';
  //   return failed.map( ([key, _]) => key).join(', ').toLowerCase().replace(/_/g, ' ');
  // }

  // private passed(codes: Partial<ISuiteTestResult>): string[] {
  //   const { messageCodes, jsonCodes, behaviorCodes } = codes as ISuiteTestResult;
  //   const passedMessages = Object.entries(messageCodes).filter( ([_, code]) => code === true);
  //   const passedJsons = Object.entries(jsonCodes).filter( ([_, code]) => code === true);
  //   const passedBehaviors = Object.entries(behaviorCodes).filter( ([_, code]) => code === true);
  //   const passed = [...passedMessages, ...passedJsons, ...passedBehaviors];
  //   return passed.map( ([key, _]) => key);
  // }

  // private failed(codes: Partial<ISuiteTestResult>): string[] {
  //   const { messageCodes, jsonCodes, behaviorCodes } = codes as ISuiteTestResult;
  //   const failedMessages = Object.entries(messageCodes).filter( ([_, code]) => code === false);
  //   const failedJsons = Object.entries(jsonCodes).filter( ([_, code]) => code === false);
  //   const failedBehaviors = Object.entries(behaviorCodes).filter( ([_, code]) => code === false);
  //   const failed = [...failedMessages, ...failedJsons, ...failedBehaviors];
  //   return failed.map( ([key, _]) => key);
  // }

  abort() {
    this.socket.terminate();
  }

  onNOTICE(notice: string) {
    //console.log(notice)
    this.notices.push(notice);
  }

  precheck(conditions: AssertWrap){
    this.logger.warn(`${this.slug} precheck method was not implemented.`, 1);
  }

  test(methods: Expect) {
    this.logger.warn(`${this.slug} complete method was not implemented.`, 1);
  }

  _onMessageEvent(message: RelayEventMessage): boolean  {
    //this should fire if EOSE was not recieved. 
    // if(this.completeOn.includes("maxEvents") && this.totalEvents >= this.maxEvents) {
    //   this.test(this.expect);
    //   this.conclude()
    //   return false;
    // }
    this.totalEvents++;
    return true;
  }

  _onMessageEose(): boolean {   
    if(this.completeOn.includes("EOSE")) {
      this.test(this.expect);
      this.conclude()
      return false
    }
    return true;
  }
}