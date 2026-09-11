/** Compact static workflow catalog. SDK call validation/handlers stay unchanged. */
import {ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {normalizeObjectSchema} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import {toJsonSchemaCompat} from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';

const maps=['properties','patternProperties','$defs'];
const singles=['items','additionalProperties','propertyNames','not'];
const lists=['anyOf','oneOf','allOf'];
const common=new Set(['type','required','enum','const','minItems','maxItems','uniqueItems','minimum','maximum',
  'exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','pattern','minProperties','maxProperties',
  'description','default','format','$schema','$ref',...maps,...singles,...lists]);
const scalarType=(v,t)=>t==='null'?v===null:t==='integer'?Number.isInteger(v):['string','boolean','number'].includes(t)&&typeof v===t;
export function simplifyWorkflowSchema(s){
  const out=children(s,simplifyWorkflowSchema);
  if(!out||typeof out!=='object'||Array.isArray(out))return out;
  // Distinct scalar types with only type-specific constraints can share a type
  // union. maxLength, for example, never restricts the integer/boolean branches.
  if(Object.keys(out).length===1&&Array.isArray(out.anyOf)){
    const scalarKeys={string:['minLength','maxLength','pattern','format'],integer:['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf'],
      number:['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf'],boolean:[],null:[]};
    const types=out.anyOf.map(b=>b?.type);
    if(types.length>1&&new Set(types).size===types.length&&!(types.includes('integer')&&types.includes('number'))
      &&out.anyOf.every(b=>b&&Object.hasOwn(scalarKeys,b.type)&&Object.keys(b).every(k=>k==='type'||scalarKeys[b.type].includes(k)))){
      const merged={type:types};for(const branch of out.anyOf)for(const[k,v]of Object.entries(branch))if(k!=='type')merged[k]=v;
      if(JSON.stringify(merged).length<JSON.stringify(out).length)return merged;
    }
  }
  // const/enum already exclude every other value and therefore imply this type.
  const values=Object.hasOwn(out,'const')?[out.const]:out.enum;
  if(typeof out.type==='string'&&Array.isArray(values)&&values.length&&values.every(v=>scalarType(v,out.type)))delete out.type;
  // In a closed object with exactly N declared keys, requiring all N keys is
  // equivalent to minProperties=N. Keep the shorter spelling, not fewer checks.
  // Pattern properties could admit other keys, so that case is deliberately excluded.
  if(out.type==='object'&&out.properties&&out.additionalProperties===false&&!out.patternProperties
    &&Array.isArray(out.required)&&out.required.length===Object.keys(out.properties).length
    &&new Set(out.required).size===out.required.length&&out.required.every(k=>Object.hasOwn(out.properties,k))){
    const minimum=Math.max(out.minProperties||0,out.required.length);
    if(JSON.stringify({minProperties:minimum}).length<JSON.stringify({required:out.required}).length){
      delete out.required;out.minProperties=minimum;
    }
  }
  if(out.type==='object'&&out.properties&&Object.keys(out.properties).length===0&&out.additionalProperties===false
    &&Object.keys(out).every(k=>['type','properties','additionalProperties'].includes(k)))return {type:'object',maxProperties:0};
  return out;
}
function children(schema,visit){
  if(!schema||typeof schema!=='object'||Array.isArray(schema))return schema;
  const out={...schema};
  for(const k of maps)if(out[k])out[k]=Object.fromEntries(Object.entries(out[k]).map(([name,s])=>[name,visit(s)]));
  for(const k of singles)if(out[k]&&typeof out[k]==='object')out[k]=visit(out[k]);
  for(const k of lists)if(Array.isArray(out[k]))out[k]=out[k].map(visit);
  return out;
}
export function expandLocalSchema(root){
  function expand(s,depth=0){
    if(depth>60)throw new Error('Recursive workflow schema');
    if(s&&typeof s==='object'&&s.$ref){
      if(Object.keys(s).length!==1||!s.$ref.startsWith('#/'))throw new Error('Nonlocal or compound schema reference');
      const value=s.$ref.slice(2).split('/').reduce((v,k)=>v?.[k.replace(/~1/g,'/').replace(/~0/g,'~')],root);
      if(value===undefined)throw new Error('Unresolved workflow schema reference');
      return expand(value,depth+1);
    }
    const out=children(s,x=>expand(x,depth+1));
    if(out&&typeof out==='object'&&!Array.isArray(out))delete out.$defs;
    return out;
  }
  return expand(root);
}
export function compactWorkflowSchema(root){
  try{
    let schema=expandLocalSchema(root),eligible=true;
    function inspect(s){
      if(typeof s==='boolean')return;
      if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!common.has(k)))eligible=false;
      children(s,x=>{inspect(x);return x;});
    }
    inspect(schema);
    // This closed keyword subset has identical draft-7/2020-12 semantics. Omit
    // the repeated dialect URI only for that subset; retain unknown schemas.
    if(!eligible||schema.$schema!=='http://json-schema.org/draft-07/schema#')return root;
    delete schema.$schema;
    schema=simplifyWorkflowSchema(schema);
    const definitions={};
    for(let i=0;i<40;i++){
      const counts=new Map(),values=new Map();
      function count(s){
        if(s&&typeof s==='object'&&!s.$ref){const key=JSON.stringify(s);counts.set(key,(counts.get(key)||0)+1);values.set(key,s);}
        children(s,x=>{count(x);return x;});
      }
      count(schema);
      const name=i.toString(36),ref={$ref:'#/$defs/'+name},size=JSON.stringify(ref).length;
      let best=null,saving=0;
      for(const [key,n]of counts){const gain=(n-1)*key.length-n*size-name.length-4;
        if(n>1&&gain>saving){best=key;saving=gain;}}
      if(!best)break;
      const replace=s=>JSON.stringify(s)===best?ref:children(s,replace);
      schema=replace(schema);definitions[name]=values.get(best);
    }
    const result=Object.keys(definitions).length?{...schema,$defs:definitions}:schema;
    return JSON.stringify(result).length<JSON.stringify(root).length?result:root;
  }catch{return root;}
}

export function workflowCatalog(server){
  if(!server.server?.setRequestHandler)return {server,publish(){}};
  const entries=[];
  return {
    server:{registerTool(name,config,handler){const tool=server.registerTool(name,config,handler);entries.push({name,tool});return tool;}},
    publish(){server.server.setRequestHandler(ListToolsRequestSchema,()=>({tools:entries.filter(({tool})=>tool.enabled).map(({name,tool})=>{
      const input=normalizeObjectSchema(tool.inputSchema);
      const result={name,title:tool.title,description:tool.description,
        inputSchema:input?compactWorkflowSchema(toJsonSchemaCompat(input,{strictUnions:true,pipeStrategy:'input'})):{type:'object'},
        annotations:tool.annotations,execution:tool.execution,_meta:tool._meta};
      if(tool.outputSchema)result.outputSchema=toJsonSchemaCompat(normalizeObjectSchema(tool.outputSchema),{strictUnions:true,pipeStrategy:'output'});
      return result;
    })}));},
  };
}
