import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true,ws:false,hmr:false,watch:null},appType:'custom'});
try {
  const {CpuPlayer}=await server.ssrLoadModule('/src/ai/index.ts');
  const {createGame,step}=await server.ssrLoadModule('/src/simulation/state.ts');
  const {ENGINE_VERSION,DATA_HASH}=await server.ssrLoadModule('/src/debug/replay.ts');
  const run=(frames)=>{
    let game=createGame();const a=new CpuPlayer('hard',0),b=new CpuPlayer('hard',1);a.reset(8);b.reset(9);
    let sum=0,max=0;const samples=[];
    for(let i=0;i<frames;i++) {
      if(game.round.phase==='matchOver'){game=createGame();a.reset(i+8);b.reset(i+9);}
      const start=performance.now(),input=a.next(game),elapsed=performance.now()-start;
      sum+=elapsed;max=Math.max(max,elapsed);samples.push(elapsed);
      step(game,[input,b.next(game)]);
    }
    samples.sort((a,b)=>a-b);
    return {frames,meanMs:sum/frames,maxMs:max,p99Ms:samples[Math.floor(frames*.99)]};
  };
  run(10000);const result={engine:ENGINE_VERSION,dataHash:DATA_HASH,node:process.version,...run(30000)};
  console.log(JSON.stringify(result,null,2));await mkdir('test-results/cpu',{recursive:true});
  await writeFile('test-results/cpu/performance.json',JSON.stringify(result,null,2)+'\n');
  if(result.meanMs>=.3||result.maxMs>=2)process.exitCode=1;
}finally{await server.close();}
