import {Ajv} from 'ajv';
import {Ajv2020} from 'ajv/dist/2020.js';

const draft7=new Ajv({strict:false,allErrors:false});
const draft2020=new Ajv2020({strict:false,allErrors:false});
export function compileSharedSchema(schema:Record<string,unknown>) {
  return (schema.$schema==='https://json-schema.org/draft/2020-12/schema'?draft2020:draft7).compile(schema);
}
