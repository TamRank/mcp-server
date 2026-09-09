#!/usr/bin/env node
/** Local operator commands only: no network, credentials, implicit startup writes or recursive removal. */
import {ScanReceiptStore,initializeReceiptDirectory} from './src/scan-receipt-store.js';
const [command,...args]=process.argv.slice(2),options={};
try{
  if(args.length%2)throw Error();
  for(let i=0;i<args.length;i+=2){if(!/^--[a-z_]+$/.test(args[i]) || Object.hasOwn(options,args[i].slice(2)))throw Error();options[args[i].slice(2)]=args[i+1];}
  const base=['directory','site','execution','reference'];
  const required={init:['directory'],list:['directory','site'],inspect:base,
    remove:[...base,'expected_hash','confirm'],export:[...base,'destination']}[command];
  if(!required || required.length!==Object.keys(options).length || !required.every(k=>options[k]))throw Error();
  let result;
  if(command==='init')result=await initializeReceiptDirectory(options.directory);
  else{
    const store=new ScanReceiptStore({directory:options.directory}),context={site_url:options.site,execution_id:options.execution};
    if(command==='list')result=await store.list({site_url:options.site});
    if(command==='inspect')result=await store.inspect(options.reference,context);
    if(command==='remove')result=await store.remove(options.reference,context,{expected_hash:options.expected_hash,confirmation:options.confirm});
    if(command==='export')result=await store.export(options.reference,context,options.destination);
  }
  process.stdout.write(JSON.stringify(result)+'\n');
}catch(error){
  process.stderr.write(JSON.stringify({code:error.code || 'scan_receipt_command_invalid',
    message:'Local receipt command refused or uncertain. No network request was made. Inspect exact private files before retrying; never repeat a measurement.'})+'\n');process.exitCode=1;
}
