export interface RecordedMetric { total:number|null; knownTasks:number; unknownTasks:number; overflow:boolean }
export interface ProjectModelUsage {
  agent?:string;
  id:string; label:string; kind:'platform'|'custom'; taskCount:number;
  credits:RecordedMetric; usd:RecordedMetric; inputTokens:RecordedMetric; outputTokens:RecordedMetric;
}
export interface ProjectSummary {
  path:string; name:string; taskIds:string[]; lastActivityAt:string|null;
  counts:{total:number;active:number;queued:number;completed:number;failed:number;cancelled:number;waitingUser:number;other:number;pendingReview:number;changesRequested:number};
  models:ProjectModelUsage[];
}
export interface ProjectTask {
  disposition?:import('./disposition-types.js').TaskDisposition;
  agent?:string;
  id:string;projectPath:string;title:string;state:string;acceptance:string;model:string;modelLabel?:string;createdAt:string;updatedAt:string;
  verification?:{status:string};
  usage?:{taskCredits:number|null;sessionCredits:number|null;inputTokens:number|null;outputTokens:number|null;usd:number|null};
}
