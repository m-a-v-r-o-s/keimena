import { writeFileSync } from 'node:fs';
const [url, out, w, h, sel] = process.argv.slice(2);
const page = await (await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(url)}`,{method:'PUT'})).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id=0; const p=new Map();
const send=(m,q={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:q}))});
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&p.has(m.id)){p.get(m.id)(m.result);p.delete(m.id);}};
await new Promise(r=>ws.onopen=r);
await send('Emulation.setDeviceMetricsOverride',{width:+w,height:+h,deviceScaleFactor:1,mobile:false});
await send('Page.enable'); await send('Page.navigate',{url});
await new Promise(r=>setTimeout(r,3500));
await send('Runtime.evaluate',{expression:`(async()=>{const s=innerHeight*0.6,m=document.body.scrollHeight;
 for(let y=0;y<m;y+=s){scrollTo(0,y);await new Promise(r=>setTimeout(r,150));}
 document.querySelector('${sel}').scrollIntoView({block:'center'});
 await new Promise(r=>setTimeout(r,1200));})()`,awaitPromise:true});
const s=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
writeFileSync(out,Buffer.from(s.data,'base64')); console.log(out);
ws.close(); await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);
