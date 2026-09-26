import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true,ws:false,hmr:false,watch:null},appType:'custom'});
try {
  const {tournament}=await server.ssrLoadModule('/scripts/cpu-tournament-lib.ts');
  const rounds=Number(process.env.CPU_ROUNDS??100);
  if(!Number.isSafeInteger(rounds)||rounds<2||rounds%2)throw Error('CPU_ROUNDS must be an even integer >= 2.');
  const results=[];
  for(const [a,b] of [['hard','medium'],['medium','easy'],['hard','easy']]) {
    const result=tournament(a,b,rounds);results.push(result);console.log(JSON.stringify(result));
  }
  await mkdir('test-results/cpu',{recursive:true});
  await writeFile('test-results/cpu/tournament.json',JSON.stringify({seed:12000,results},null,2)+'\n');
  if(results.slice(0,2).some(r=>r.winsA/r.rounds<.65))process.exitCode=1;
}finally{await server.close();}
