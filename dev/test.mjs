/*
 * Browser checks for docs/tank.js. Run from anywhere: node dev/test.mjs
 * Needs Google Chrome on macOS. Starts a fake NodeMCU (dev/test-server.mjs) on port 8765 and drives
 * headless Chrome over http://tank.test, which is not a secure origin, like the real http://192.168.1.58.
 * Exits non-zero if any check fails.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const SP = mkdtempSync(join(tmpdir(), 'tank-test-'));
const here = p => fileURLToPath(new URL(p, import.meta.url));
const server = spawn(process.execPath, [here('./test-server.mjs'), here('../docs/tank.js')], { stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new','--disable-gpu','--remote-debugging-port=9333',`--user-data-dir=${SP}/prof-e2e-${Date.now()}`,'--host-resolver-rules=MAP tank.test 127.0.0.1','--window-size=500,1500','about:blank'],{stdio:'ignore'});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let tabs; for(let i=0;i<40;i++){ try{ tabs=await (await fetch('http://127.0.0.1:9333/json')).json(); if(tabs.find(t=>t.type==='page'))break;}catch{} await sleep(250);}
const ws = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0; const pend=new Map(); const errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
 if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
 if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(JSON.stringify(m.params.args.map(a=>a.value)));};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); if(r.result.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value;};
const results=[]; const check=(n,ok,info='')=>{results.push(ok);console.log((ok?'PASS ':'FAIL ')+n+(info!==''?'  -> '+info:''));};
const rect=sel=>ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,l:r.left,w:r.width}})()`);
const click=async(x,y)=>{for(const type of['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});};
const clickSel=async s=>{await ev(`document.querySelector(${JSON.stringify(s)}).scrollIntoView({block:'center'})`);const r=await rect(s);await click(r.x,r.y);await sleep(150);};
await send('Runtime.enable');await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const R=Date;window.__off=0;class D extends R{constructor(...a){a.length?super(...a):super(R.now()+window.__off)}static now(){return R.now()+window.__off}};window.Date=D})()`});
const nav=async(u,tab=true)=>{await send('Page.navigate',{url:u});await sleep(1500);if(tab){await ev(`document.getElementById('tabHistory').click()`);await sleep(200);}};

await nav('http://tank.test:8765/',false);
check('home screen and tab icons added', await ev(`['icon','apple-touch-icon'].every(r=>document.querySelector('link[rel="'+r+'"]')?.href.endsWith('/icon.png'))`));
check('icon loads at 512px', (await ev(`new Promise(r=>{const i=new Image();i.onload=()=>r(i.naturalWidth);i.onerror=()=>r(0);i.src=document.querySelector('link[rel=icon]').href})`))===512);
check('opens on Today', await ev(`tabToday.getAttribute('aria-selected')==='true' && !panelToday.hidden && panelHistory.hidden`));
check('hidden panels take no space', await ev(`getComputedStyle(panelHistory).display==='none'`));
await sleep(3500);
check('polling leaves hidden chart alone', await ev(`document.getElementById('chart').children.length===0`));
await clickSel('#tabHistory');
check('History tab shows, Today hides', await ev(`panelToday.hidden && !panelHistory.hidden && getComputedStyle(panelToday).display==='none'`));
check('chart sized to its visible width', await ev(`document.querySelector('#chart svg').viewBox.baseVal.width===document.getElementById('chart').clientWidth && document.getElementById('chart').clientWidth>320`), await ev(`document.getElementById('chart').clientWidth`));
check('status banner visible on History', await ev(`document.querySelector('.fab').getBoundingClientRect().height===64`));
await ev(`tabHistory.focus()`);
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});await sleep(100);
check('arrow key switches tab and moves focus', await ev(`!panelToday.hidden && document.activeElement===tabToday`));
check('gauge intact on Today', await ev(`document.getElementById('levelBig').textContent!=='--'`), await ev(`document.getElementById('levelBig').textContent`));
await clickSel('#tabHistory');
check('insecure origin, no navigator.clipboard', await ev(`!isSecureContext && !navigator.clipboard`));
check('7 day buttons', (await ev(`document.querySelectorAll('#days button').length`))===7);
check('today selected', (await ev(`document.querySelector('#days [aria-pressed=true]').textContent`)).startsWith('Today'));
check('line has gaps (several M segments)', (await ev(`(document.querySelector('.hline').getAttribute('d').match(/M/g)||[]).length`))>=3, await ev(`(document.querySelector('.hline').getAttribute('d').match(/M/g)||[]).length`));
check('100% labelled', await ev(`[...document.querySelectorAll('#chart text')].some(t=>t.textContent==='100%')`));
check('red label says 64%', await ev(`[...document.querySelectorAll('#chart text')].some(t=>t.textContent==='red 64%')`));
const days=await ev(`[...document.querySelectorAll('#days button')].map(b=>b.dataset.day+(b.className?':none':''))`); console.log('   days',days.join(' '));

// past day with data
await clickSel('#days button:nth-child(6)');
check('past day shows data', (await ev(`document.getElementById('dayHigh').textContent`))!=='--', await ev(`document.getElementById('dayName').textContent+' | '+dayHigh.textContent+' | '+dayLow.textContent+' | '+dayCount.textContent`));
const before=await ev(`document.querySelector('.hline').getAttribute('d').length`);
await sleep(3500);
check('day high is share of whole tank (about 50 cm of 70)', ['71%','72%'].includes(await ev(`document.getElementById('dayHigh').textContent`)), await ev(`document.getElementById('dayHigh').textContent`));
check('line stays inside the plot', await ev(`document.querySelector('.hline').getAttribute('d').match(/[ML][0-9.]+ [0-9.]+/g).every(p=>{const y=parseFloat(p.split(' ')[1]);return y>=10&&y<=198})`));
check('past day stays selected across polls', (await ev(`document.querySelector('#days [aria-pressed=true]').dataset.day`))===days[5].split(':')[0]);
// empty day
await clickSel('#days button:nth-child(5)');
check('empty day empty state', await ev(`document.getElementById('dayHigh').textContent==='--' && dayCount.textContent==='0' && document.getElementById('chart').textContent.includes('No readings this day')`));
await clickSel('#days button:nth-child(6)');

// hover on the line, then in a gap
await ev(`document.getElementById('chart').scrollIntoView({block:'center'})`);
const c=await rect('#chart svg');
const px=h=>c.l+36+(h/24)*(c.w-44);
await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:px(13),y:c.y}); await sleep(100);
const t1=await ev(`document.getElementById('tip').textContent`); check('hover on data shows value', /\d+% 1[23]:\d\d/.test(t1), t1);
await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:px(3),y:c.y}); await sleep(100);
const t2=await ev(`document.getElementById('tip').textContent`); check('hover in gap says no readings', t2.includes('no readings'), t2);
const tb=await ev(`(()=>{const t=document.getElementById('tip').getBoundingClientRect(),b=document.getElementById('chart').getBoundingClientRect();return t.left>=b.left-1&&t.right<=b.right+1})()`); check('tooltip inside chart',tb);
await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:px(23.9),y:c.y}); await sleep(100);
check('tooltip inside chart at right edge', await ev(`(()=>{const t=document.getElementById('tip').getBoundingClientRect(),b=document.getElementById('chart').getBoundingClientRect();return t.right<=b.right+1})()`));
await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5}); await sleep(100);
check('tooltip hides on leave', await ev(`document.getElementById('tip').hidden`));

// copy via real click, capture what the copy event selected
await ev(`document.addEventListener('copy',()=>{window.__copied=document.activeElement.value||''},true)`);
await clickSel('#copy');
const msg=await ev(`document.getElementById('copyMsg').textContent`); check('copy works without navigator.clipboard', msg.startsWith('Copied'), msg);
const csv=await ev(`window.__copied`); const lines=csv.trim().split('\n');
console.log('   '+lines.slice(0,3).join(' | ')+' ... ('+csv.length+' bytes)');
check('csv header', lines[0]==='time,level_pct,distance_cm,readings,no_echo');
check('csv rows well formed', lines.slice(1).every(l=>/^\d{4}-\d\d-\d\d \d\d:\d\d,(\d+\.\d)?,(\d+\.\d)?,\d+,\d+$/.test(l)));
check('csv sorted, no duplicate minutes', lines.slice(1).every((l,i,a)=>!i||a[i-1].slice(0,16)<l.slice(0,16)));
check('msg row count matches', msg.includes(String(lines.length-1).replace(/\B(?=(\d{3})+$)/g,',')), lines.length-1);
await ev(`document.execCommand=()=>false`);
await clickSel('#copy');
check('manual fallback textarea when copy refused', await ev(`!document.getElementById('copyBox').hidden && document.getElementById('copyBox').value.startsWith('time,')`), await ev(`document.getElementById('copyMsg').textContent`));

// touch tap on phone width
await nav('http://tank.test:8765/');
await send('Emulation.setDeviceMetricsOverride',{width:360,height:740,deviceScaleFactor:2,mobile:true});
await send('Emulation.setTouchEmulationEnabled',{enabled:true});
await sleep(400);
check('no horizontal scroll at 360px', await ev(`document.documentElement.scrollWidth<=innerWidth`), await ev(`document.documentElement.scrollWidth`));
check('chart redrew for new width', await ev(`document.querySelector('#chart svg').viewBox.baseVal.width===document.getElementById('chart').clientWidth`));
await ev(`document.getElementById('chart').scrollIntoView({block:'center'})`);
const m=await rect('#chart svg'); const tx=m.l+36+(13/24)*(m.w-44);
await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:m.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(150);
check('tap shows and keeps tooltip', await ev(`!document.getElementById('tip').hidden`), await ev(`document.getElementById('tip').textContent`));
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});await sleep(200);
const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
(await import('node:fs')).writeFileSync(SP+'/light-phone.png',Buffer.from(shot.result.data,'base64'));
await send('Emulation.setEmulatedMedia',{features:[]});
{ const o=await rect('#days button:first-child');
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:o.x,y:o.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(200);
  check('tap outside chart dismisses readout', await ev(`document.getElementById('tip').hidden`));
  await ev(`document.querySelector('#days button:last-child').click()`); }
for (const [w,h] of [[320,568],[360,740],[390,844]]) {
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:2,mobile:true}); await sleep(300);
  const clipped=`[...document.querySelectorAll('button,dd,dt,h1,h2,p,.chip,.hist-actions')].filter(e=>e.offsetParent&&e.scrollWidth>e.clientWidth+1).map(e=>(e.id||e.tagName)+':'+e.textContent.slice(0,12))`;
  const small=`[...document.querySelectorAll('button')].filter(e=>e.offsetParent&&e.getBoundingClientRect().height<44).map(e=>e.textContent)`;
  for (const tab of ['Today','History','Settings']) {
    await ev(`window.scrollTo(0,0);document.getElementById('tab${tab}').click()`); await sleep(200);
    check(`${w}px ${tab}: no sideways scroll`, await ev(`document.documentElement.scrollWidth<=innerWidth`));
    const c=await ev(clipped); check(`${w}px ${tab}: nothing clipped`, c.length===0, c.join(' '));
    const t=await ev(small); check(`${w}px ${tab}: buttons 44px tall`, t.length===0, t.join(' '));
  }
  await ev(`document.getElementById('tabToday').click();window.scrollTo(0,0)`); await sleep(150);
  const fold=await ev(`document.getElementById('levelBig').getBoundingClientRect().bottom`);
  check(`${w}px: level number above the fold`, fold<h, Math.round(fold)+' of '+h);
  const scale=await ev(`(()=>{const r=document.querySelector('.gauge svg').getBoundingClientRect();return Math.min(r.width/300,r.height/420)})()`);
  check(`${w}px: gauge labels at least 8px`, scale*13>=8, (scale*13).toFixed(1)+'px');
}
await ev(`document.getElementById('tabHistory').click()`);
check('manual copy box is 16px (no iOS zoom)', await ev(`getComputedStyle(document.getElementById('copyBox')).fontSize==='16px'`));
await send('Emulation.setTouchEmulationEnabled',{enabled:false});await send('Emulation.clearDeviceMetricsOverride');
await send('Emulation.setDeviceMetricsOverride',{width:900,height:900,deviceScaleFactor:1,mobile:false});await ev(`document.getElementById('tabToday').click()`);await sleep(300);
check('desktop keeps gauge on the left', await ev(`document.querySelector('.gauge').getBoundingClientRect().left<document.getElementById('levelBig').getBoundingClientRect().left`));
await ev(`document.getElementById('tabHistory').click()`);await send('Emulation.clearDeviceMetricsOverride');await sleep(200);

// midnight rollover while the page stays open
const k0=await ev(`document.querySelector('#days [aria-pressed=true]').dataset.day`);
await ev(`(()=>{const n=new Date();const next=new Date(n.getFullYear(),n.getMonth(),n.getDate()+1,0,5);window.__off+=next.getTime()-n.getTime()})()`);
await sleep(4000);
const k1=await ev(`document.querySelector('#days [aria-pressed=true]').dataset.day`);
check('after midnight follows new day', k1>k0, k0+' -> '+k1);
check('new day has its reading', (await ev(`document.getElementById('dayCount').textContent`))!=='0', await ev(`document.getElementById('dayCount').textContent`));

// first run, nothing stored
await nav('http://tank.test:8765/?noseed');
await ev(`localStorage.clear()`); await nav('http://tank.test:8765/?noseed');
await ev(`(()=>{const n=0})()`);
check('first run reading appears without waiting a minute', (await (async()=>{await sleep(3500);return ev(`document.getElementById('dayCount').textContent`)})())!=='0');
// ---- settings ----
await nav('http://tank.test:8765/',false); await sleep(3200);
await ev(`window.__fetch=window.fetch`);
check('default tank: 38.4 cm gap is 45%', (await ev(`document.getElementById('levelBig').textContent`))==='45%');
check('dot is green and says Live, no word on screen', await ev(`document.getElementById('conn').getAttribute('aria-label')==='Live' && document.getElementById('conn').textContent==='' && getComputedStyle(document.getElementById('conn')).backgroundColor===getComputedStyle(document.querySelector('.fab')).backgroundColor`));
await send('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:2,mobile:true}); await sleep(200);
check('320px bar fits on one row', await ev(`(()=>{const h=document.querySelector('h1').getBoundingClientRect(),n=document.getElementById('tabs').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth && n.right<=innerWidth && h.right<=n.left && Math.abs((h.top+h.height/2)-(n.top+n.height/2))<2})()`), await ev(`Math.round(document.getElementById('tabs').getBoundingClientRect().left-document.querySelector('h1').getBoundingClientRect().right)+'px spare'`));
for(const sc of ['Today','History','Settings']){await ev(`document.getElementById('tab${sc}').click();window.scrollTo(0,300)`);await sleep(120);
 check(`bar stays at top on ${sc}`, await ev(`(()=>{const b=document.querySelector('header').getBoundingClientRect();const r=document.getElementById('tabSettings').getBoundingClientRect();return b.top===0 && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).closest('#tabSettings')!==null})()`));}
await ev(`tabToday.click()`);await sleep(100);
await ev(`window.scrollTo(0,300);tabHistory.click()`);await sleep(150);check('switching tab returns to the top', await ev(`scrollY===0`));await ev(`tabToday.click()`);await sleep(100);
await clickSel('#tabSettings');
check('Settings tab opens, indicator stays', await ev(`!panelSettings.hidden && panelToday.hidden && panelHistory.hidden && document.querySelector('.fab').getBoundingClientRect().height===64`));
check('320px settings fit', await ev(`document.documentElement.scrollWidth<=innerWidth`));
check('settings buttons 44px', await ev(`[...panelSettings.querySelectorAll('button,input')].every(e=>e.getBoundingClientRect().height>=44)`));
check('input is 16px', await ev(`getComputedStyle(tankInput).fontSize==='16px'`));
const bg=()=>ev(`getComputedStyle(document.body).backgroundColor`);
await clickSel('[data-theme-choice=light]'); const light=await bg();
await clickSel('[data-theme-choice=dark]'); const dark=await bg();
check('light and dark really differ', light!==dark, light+' / '+dark);
await sleep(200);
await nav('http://tank.test:8765/',false); await sleep(300);
check('first visit: warning shows', await ev(`getComputedStyle(document.getElementById('notice')).display!=='none'`));
check('dark survives reload', (await ev(`document.documentElement.dataset.theme`))==='dark' && (await bg())===dark);
const raw=`localStorage.getItem('tank.settings')`;
check('theme is in localStorage', (await ev(raw)).includes('"theme":"dark"'), await ev(raw));
await clickSel('#tabSettings');
check('input shows current depth', (await ev(`tankInput.value`))==='70');
for (const bad of ['10','25','900','']) { await ev(`tankInput.value=${JSON.stringify(bad)}`); await clickSel('#tankForm button');
  check(`rejects "${bad}"`, (await ev(`tankMsg.textContent`)).startsWith('Enter a depth') && (await ev(`document.getElementById('waterAvail').textContent`))==='31.6 cm'); }
await ev(`tankInput.value='120'`); await clickSel('#tankForm button'); await sleep(200);
check('save message', (await ev(`tankMsg.textContent`)).includes('red line at 79%'), await ev(`tankMsg.textContent`));
await ev(`window.__fetch=window.fetch`);
await clickSel('#tabToday');
check('Today tab returns from Settings', await ev(`!panelToday.hidden && panelSettings.hidden`));
await sleep(3200);
check('level recalculated', (await ev(`document.getElementById('levelBig').textContent`))==='68%', await ev(`document.getElementById('levelBig').textContent`));
check('gauge in percent, cm tile follows depth', await ev(`[...document.querySelectorAll('.gauge text')].some(t=>t.textContent==='75%') && [...document.querySelectorAll('.gauge text')].some(t=>t.textContent==='79%') && document.getElementById('levelTag').textContent==='68%' && document.getElementById('waterAvail').textContent==='81.6 cm'`));
const setD=async d=>{await ev(`window.fetch=()=>Promise.resolve({json:()=>Promise.resolve({d:${d}})})`);await sleep(3300);return ev(`document.getElementById('levelBig').textContent+' '+document.body.dataset.state`);};
for(const [d,want] of [[25,'79% red'],[26,'78% green'],[60,'50% green'],[120,'0% green'],[0,'100% red']]){const got=await setD(d);check(`120 cm tank: d=${d} is ${want}`,got===want,got);}
const fab=()=>ev(`document.getElementById('fabLabel').textContent+' '+document.body.dataset.state+' '+getComputedStyle(document.querySelector('.fab')).backgroundColor`);
await setD(25); { const f=await fab(); check('red: OFF on red', /^OFF red rgb\(255, 91, 77\)|^OFF red rgb\(211, 58, 46\)/.test(f), f); }
await setD(60); { const f=await fab(); check('green: OK on green', /^OK green rgb\(60, 192, 122\)|^OK green rgb\(35, 144, 90\)/.test(f), f); }
await setD('null'); { const f=await fab(); check('no echo is grey, never green', f.startsWith('-- off'), f); check('dot says no echo', (await ev(`document.getElementById('conn').getAttribute('aria-label')`))==='No echo from the sensor'); }
await ev(`window.fetch=()=>Promise.reject(new Error('x'))`);await sleep(7000); { const f=await fab(); check('offline is grey, never green', f.startsWith('-- off'), f); }
check('screen reader still gets the detail', (await ev(`document.getElementById('fabInfo').textContent`)).includes('NodeMCU not responding'));
check('banner is gone', await ev(`!document.querySelector('.status')&&!document.getElementById('statusTitle')`));
await ev(`window.fetch=window.__fetch`);await sleep(3300);
for(const [tab,sel] of [['tabHistory','#copy'],['tabSettings','#tankForm button']]){await ev(`document.getElementById('${tab}').click();window.scrollTo(0,document.documentElement.scrollHeight)`);await sleep(250);
 check(`320px: floating indicator clears ${sel} at page end`, await ev(`(()=>{const a=document.querySelector('.fab').getBoundingClientRect(),b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return a.right<b.left||b.right<a.left||a.bottom<b.top||b.bottom<a.top})()`));}
await ev(`tabToday.click();window.scrollTo(0,0)`);await sleep(200);
const water=await ev(`parseFloat(document.getElementById('water').style.transform.slice(11))`);
check('water position uses new scale', Math.abs(water-(120-81.6)*350/120)<.2, water);
await clickSel('#tabHistory');
const texts=await ev(`[...document.querySelectorAll('#chart text')].map(t=>t.textContent)`);
check('chart axis and red line follow depth', texts.includes('100%')&&texts.includes('red 79%'), texts.filter(t=>/^\d+$|red/.test(t)).join(' '));
await clickSel('#tabSettings'); await clickSel('#tabHistory');
check('History from Settings has a sized chart', await ev(`!panelHistory.hidden && document.querySelector('#chart svg').viewBox.baseVal.width===document.getElementById('chart').clientWidth`));
await nav('http://tank.test:8765/',false); await sleep(500);
await sleep(3000);check('depth survives reload', (await ev(`document.getElementById('waterAvail').textContent`))==='81.6 cm');
await clickSel('#tabSettings'); await clickSel('[data-theme-choice=system]');
check('System removes override', !(await ev(`document.documentElement.hasAttribute('data-theme')`)));
const avail=()=>ev(`document.getElementById('availLabel').textContent+' = '+document.getElementById('waterAvail').textContent`);
check('no diameter: says up to cm', (await avail())==='Water available up to = 81.6 cm', await avail());
await ev(`tankDiameter.value='5'`); await clickSel('#tankForm button');
check('rejects diameter 5', (await ev(`tankMsg.textContent`)).startsWith('Enter a diameter'), await ev(`tankMsg.textContent`));
await ev(`tankDiameter.value='100'`); await clickSel('#tankForm button'); await sleep(200);
check('save message gives capacity (pi*50^2*120/1000 = 942 L)', (await ev(`tankMsg.textContent`)).includes('holds 942 L'), await ev(`tankMsg.textContent`));
await clickSel('#tabToday');
check('diameter: litres (pi*50^2*81.6/1000 = 641 L)', (await avail())==='Water available = 641 L', await avail());
check('320px litres fit', await ev(`document.documentElement.scrollWidth<=innerWidth`));
await nav('http://tank.test:8765/',false); await sleep(3200);
check('diameter survives reload', (await avail())==='Water available = 641 L', await avail());
check('diameter is in localStorage', (await ev(raw)).includes('"diameterCm":100'), await ev(raw));
await clickSel('#tabSettings');
check('diameter shown in settings', (await ev(`tankDiameter.value`))==='100');
await ev(`tankDiameter.value=''`); await clickSel('#tankForm button'); await sleep(200); await clickSel('#tabToday');
check('blank goes back to cm', (await avail())==='Water available up to = 81.6 cm', await avail());
await send('Emulation.clearDeviceMetricsOverride');
// settings lost
const notice=()=>ev(`getComputedStyle(document.getElementById('notice')).display!=='none'`);
check('saved size: no warning after reload', !(await notice()));
await ev(`localStorage.removeItem('tank.settings')`);
await nav('http://tank.test:8765/',false); await sleep(3200);
check('lost settings: warning shows', await notice(), await ev(`document.querySelector('#notice p').textContent`));
check('lost settings: back on default', (await ev(`document.getElementById('waterAvail').textContent`))==='31.6 cm');
await clickSel('#tabHistory'); check('warning shows on History too', await notice());
await clickSel('#noticeSet');
check('warning button opens Settings', await ev(`!panelSettings.hidden`));
check('warning hidden on Settings', !(await notice()));
await clickSel('#tabToday');
await ev(`tabSettings.click();document.querySelector('[data-theme-choice=dark]').click()`); await sleep(100); await clickSel('#tabToday');
check('changing theme does not clear warning', await notice());
await clickSel('#tabSettings'); await clickSel('#tankForm button'); await sleep(100); await clickSel('#tabToday');
check('saving 70 clears warning', !(await notice()));
await nav('http://tank.test:8765/',false);
check('still clear after reload', !(await notice()));
// Today fits the screen unless it is shorter than the minimum
for (const [w,h,fits] of [[360,600,true],[375,667,true],[360,740,true],[412,760,true],[412,915,true],[390,844,true],[430,932,true],[320,568,false],[360,500,false]]) {
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:2,mobile:true});
  await ev(`tabToday.click()`); await sleep(250);
  const noScroll=await ev(`document.documentElement.scrollHeight<=innerHeight`);
  check(`${w}x${h}: Today ${fits?'has no scroll':'scrolls'}`, noScroll===fits, await ev(`document.documentElement.scrollHeight+' of '+innerHeight`));
  if (fits) {
    check(`${w}x${h}: tank card fills to the bottom`, await ev(`Math.abs(innerHeight-16-document.querySelector('.gauge').getBoundingClientRect().bottom)<=1`));
    const tankCard=await ev(`(()=>{const g=document.querySelector('.gauge').getBoundingClientRect(),c=document.getElementById('levelBig').closest('.card').getBoundingClientRect();return Math.round(c.height)+' + '+Math.round(g.height)})()`);
    console.log('   cards: '+tankCard);
  }
  check(`${w}x${h}: indicator clear of the tank`, await ev(`(()=>{const f=document.querySelector('.fab').getBoundingClientRect(),t=document.querySelector('.tank-wall').getBoundingClientRect();return t.right<f.left||t.bottom<f.top})()`));
}
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false}); await sleep(250);
check('desktop Today has no scroll', await ev(`document.documentElement.scrollHeight<=innerHeight`), await ev(`document.documentElement.scrollHeight+' of '+innerHeight`));
await ev(`tabHistory.click()`); await sleep(200);
check('History keeps room for the indicator', await ev(`getComputedStyle(document.body).paddingBottom==='96px'`));
await send('Emulation.clearDeviceMetricsOverride');
// localStorage blocked must not stop the page
await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.search.includes('lsthrow'))Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}});`});
await nav('http://tank.test:8765/?noseed&lsthrow',false);await sleep(2500);
check('storage blocked: page runs on defaults', (await ev(`document.getElementById('waterAvail').textContent`))==='31.6 cm' && (await ev(`document.getElementById('conn').getAttribute('aria-label')`))==='Live');
check('storage blocked: warning shows', await notice());
await clickSel('#tabSettings'); await ev(`tankInput.value='80'`); await clickSel('#tankForm button'); await sleep(200);
check('storage blocked: says it did not save', (await ev(`tankMsg.textContent`)).startsWith('Could not save'), await ev(`tankMsg.textContent`));
await clickSel('#tabToday'); check('storage blocked: warning stays after failed save', await notice());
check('no page errors', errors.length===0, errors.slice(0,3).join(' ; '));
console.log(results.filter(Boolean).length+'/'+results.length+' passed');
ws.close(); chrome.kill(); server.kill(); process.exit(results.every(Boolean) ? 0 : 1);
