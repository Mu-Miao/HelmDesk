import { lazy, Suspense, useState } from 'react';
const MarkdownResult=lazy(()=>import('./MarkdownResult'));
export function ResultSummary({text,error=false}:{text:string;error?:boolean}){
  const[raw,setRaw]=useState(false);
  return <div className={error?'result-document result-error':'result-document'}>
    <div className="document-toolbar"><span>{error?'执行反馈':'交付摘要'}</span><div role="group" aria-label="摘要显示方式"><button aria-pressed={!raw} onClick={()=>setRaw(false)}>排版</button><button aria-pressed={raw} onClick={()=>setRaw(true)}>原文</button></div></div>
    {raw?<pre className="result-raw">{text}</pre>:<Suspense fallback={<div className="result-loading">{text}</div>}><MarkdownResult text={text}/></Suspense>}
  </div>;
}
