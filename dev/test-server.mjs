import http from 'node:http'; import fs from 'node:fs';
const js = process.argv[2];
const seed = `(function(){const pad=n=>String(n).padStart(2,'0');const now=new Date();
for(let i=0;i<7;i++){if(i===2||i===5)continue;const s=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i);const list=[];
 const k='tank.day.'+s.getFullYear()+'-'+pad(s.getMonth()+1)+'-'+pad(s.getDate());
 const spans=[[6.2,7.1],[9,9.02],[12.5,14.3],[19,21.5]];
 for(const [a,b] of spans){for(let h=a;h<b;h+=3/3600){const t=s.getTime()+h*3600000;if(t>Date.now())break;
  const lvl=20+(h-a)/(b-a)*30+Math.sin(h*40)*.4; list.push([Math.round(t),Math.round((70-lvl)*10)/10]); if(Math.random()<.002)list.push([Math.round(t)+1,null]);}}
 localStorage.setItem(k,JSON.stringify(list));}})();`;
http.createServer((q,r)=>{
 if(q.url.startsWith('/api')){r.setHeader('content-type','application/json');return r.end('{ "d": 38.4 }');}
 if(q.url.startsWith('/recycling-water.png')){r.setHeader('content-type','image/png');return r.end(fs.readFileSync(new URL('recycling-water.png',`file://${js}`)));}
 if(q.url.startsWith('/tank.js')){r.setHeader('content-type','text/javascript');return r.end(fs.readFileSync(js));}
 r.setHeader('content-type','text/html');
 r.end(`<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>t</title></head><body><script>if(!location.search.includes('noseed'))${seed}</script><script src=/tank.js></script></body></html>`);
}).listen(8765,'0.0.0.0',()=>console.log('up'));
