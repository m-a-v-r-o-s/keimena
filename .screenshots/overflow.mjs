const [url,w] = process.argv.slice(2);
const page = await (await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(url)}`,{method:'PUT'})).json();
const ws = new WebSocket(page.webSocketDebuggerUrl); let id=0; const p=new Map();
const send=(m,q={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:q}))});
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&p.has(m.id)){p.get(m.id)(m.result);p.delete(m.id);}};
await new Promise(r=>ws.onopen=r);
await send('Emulation.setDeviceMetricsOverride',{width:+w,height:800,deviceScaleFactor:1,mobile:true});
await send('Page.enable'); await send('Page.navigate',{url});
await new Promise(r=>setTimeout(r,3000));
const res=await send('Runtime.evaluate',{expression:`(()=>{
  const vw=innerWidth; const bad=[];
  document.querySelectorAll('.nav a, .nav__mark, .buy__row a, h1, h2').forEach(e=>{
    const r=e.getBoundingClientRect();
    if(r.right>vw+1||r.left<-1) bad.push(e.className+'|'+Math.round(r.left)+'-'+Math.round(r.right));
  });
  return JSON.stringify({vw, docScrollW:document.documentElement.scrollWidth, clipped:bad});
})()`,returnByValue:true});
console.log(`w=${w} ->`, res.result.value); ws.close();
await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);
