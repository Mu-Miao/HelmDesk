import React, { memo, useMemo, useState } from 'react';
import type { Task } from '../../src/types';
import {parseDiff} from './diff-model';
type Change=NonNullable<Task['changes']>[number];
const kinds:Record<string,string>={added:'新增',modified:'修改',deleted:'删除'};
const FileDiff=memo(function FileDiff({change,initialOpen}:{change:Change;initialOpen:boolean}){
 const[open,setOpen]=useState(initialOpen),[raw,setRaw]=useState(false),[wrap,setWrap]=useState(true),[limit,setLimit]=useState(200);
 const parsed=useMemo(()=>open?parseDiff(change.diff):null,[change.diff,open]);
 return <details className="change formatted-change" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary><span className="change-path">{change.path}</span><span className="change-kind">{kinds[change.kind]??change.kind}</span>{parsed?<span className="diff-stats"><b className="diff-plus" aria-label={`新增 ${parsed.added} 行`}>+{parsed.added}</b><b className="diff-minus" aria-label={`删除 ${parsed.removed} 行`}>−{parsed.removed}</b></span>:null}</summary>
  {parsed?<><div className="diff-toolbar"><span>{parsed.lines.length} 行{parsed.binary?' · 二进制文件':''}</span><div><button aria-pressed={wrap} disabled={raw} onClick={()=>setWrap(v=>!v)}>自动换行</button><button aria-pressed={raw} onClick={()=>setRaw(v=>!v)}>{raw?'返回差异视图':'原始差异'}</button></div></div>
   {parsed.truncated?<p className="diff-notice">差异显示已截断，完整文件保留在独立工作目录。</p>:null}
   {raw?<pre className="diff-raw">{change.diff}</pre>:<div className={wrap?'diff-scroll diff-wrap':'diff-scroll'} role="region" aria-label={`${change.path} 的差异`} tabIndex={0}><table className="diff-table"><colgroup><col className="diff-number-col"/><col className="diff-number-col"/><col className="diff-sign-col"/><col/></colgroup><thead><tr><th>旧行</th><th>新行</th><th aria-label="增删标记"/><th>内容</th></tr></thead><tbody>{parsed.lines.slice(0,limit).map((line,index)=><tr className={`diff-line diff-line-${line.kind}`} key={index}><td className="diff-number">{line.oldLine??''}</td><td className="diff-number">{line.newLine??''}</td><td className="diff-sign">{line.kind==='added'?'+':line.kind==='removed'?'−':''}</td><td className="diff-code"><code>{line.text||'\u00a0'}</code></td></tr>)}</tbody></table></div>}
   {!raw&&parsed.lines.length>limit?<button className="diff-more" onClick={()=>setLimit(n=>n+200)}>已显示 {limit} / {parsed.lines.length} 行 · 再展开 200 行</button>:null}
  </>:null}
 </details>;
});
export function DiffView({changes}:{changes:NonNullable<Task['changes']>}){
 return <div className="diff-view"><p className="caption">{changes.length} 个文件 · 点击文件名展开或收起</p>{changes.map((change,index)=><FileDiff key={change.path} change={change} initialOpen={index===0}/>)}</div>;
}
