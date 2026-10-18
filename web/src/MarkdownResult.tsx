import React, { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
const plugins = [remarkGfm];
const components: Components = {
  a: ({href,children}) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  img: ({alt}) => alt ? <span className="markdown-image-alt">[图片：{alt}]</span> : null,
  table: ({children}) => <div className="markdown-table-scroll"><table>{children}</table></div>,
  h1: ({children}) => <h4>{children}</h4>,
  h2: ({children}) => <h4>{children}</h4>,
  h3: ({children}) => <h5>{children}</h5>,
};
function safeUrl(url:string) {return /^https?:\/\//i.test(url)||url.startsWith('#') ? url : '';}
function MarkdownResult({text}:{text:string}) {
  return <div className="markdown-result"><Markdown remarkPlugins={plugins} components={components} skipHtml urlTransform={safeUrl}>{text}</Markdown></div>;
}
export default memo(MarkdownResult);
