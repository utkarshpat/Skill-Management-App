export interface Column {type:string;nullable:boolean;declaration:string;source:string}
export interface ForeignKey {columns:string[];target:string;targetColumns:string[];source:string}
export interface Table {source:string;domain:string;columns:Record<string,Column>;pk:string[];unique:string[][];fks:ForeignKey[];constraints:{sql:string;source:string}[];indexes:{name:string;unique:boolean;columns:string[];filter:string;source:string}[]}
export interface Section {id:string;title:string;content:string;source:string}
export interface Knowledge {title:string;version:string;revision:string;basis:string;sections:Section[];schema:{tables:Record<string,Table>;migrations:string[];views:Record<string,{sql:string;source:string}>;removedTables:string[]};routes:{method:string;path:string;module:string;source:string}[];procedures:{name:string;kind:string;signature:string;source:string}[];groups:Record<string,string[]>;ai:{configured:boolean;provider:string|null};temporary:boolean}
export interface Source {id:string;title:string;href:string}
export interface ChatMessage {role:'user'|'assistant';content:string;sources?:Source[]}
export const sourceUrl=(path:string)=>'https://github.com/utkarshpat/Skill-Management-App/blob/main/'+path;
export function safeDocUrl(url:string){return /^\/knowledgetransfer#[a-zA-Z0-9_-]+$/.test(url)||url.startsWith('https://github.com/utkarshpat/Skill-Management-App/')?url:'';}
