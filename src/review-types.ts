import type {State,Task} from './types.js';
export type Attention='review'|'rework'|'intervention';
export interface ReviewCard {
 id:string;title:string;state:State;acceptance:Task['acceptance'];verification:'passed'|'failed'|'not_run';
 agent:string;requestedModel:string;reportedModel:string|null;reasoningEffort:string|null;updatedAt:string;
 attention:Attention|null;summary:string;summaryTruncated:boolean;error:string;errorTruncated:boolean;
 fileCount:number;files:{path:string;kind:string}[];filesTruncated:boolean;
 usage:{taskCredits:number|null;inputTokens:number|null;outputTokens:number|null;usd:number|null};
 dispositionStatus?:import('./disposition-types.js').DispositionStatus;
}
export interface TaskBrief extends ReviewCard {version:string}
