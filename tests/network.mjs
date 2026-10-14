import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
const base=process.env.GAME_BASE_URL||'http://127.0.0.1:8787';
const results=[];
const origin=process.env.GAME_ORIGIN;
async function socketStatus(session, requestOrigin) {
  return new Promise((resolve,reject)=>{
    const url=new URL(`/api/rooms/${session.code}/ws`,base);
    url.search=new URLSearchParams({id:session.id,token:session.token}).toString();
    const req=(base.startsWith('https')?httpsRequest:httpRequest)(url,{headers:{Origin:requestOrigin,Upgrade:'websocket',Connection:'Upgrade','Sec-WebSocket-Key':randomBytes(16).toString('base64'),'Sec-WebSocket-Version':'13'}},res=>{res.resume();resolve(res.statusCode);});
    req.on('upgrade',(res,socket)=>{socket.destroy();resolve(res.statusCode);});
    req.on('error',reject);req.setTimeout(15000,()=>req.destroy(Error('WebSocket handshake timed out')));req.end();
  });
}
async function post(path,data){const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(data)});if(origin)assert.equal(r.headers.get('access-control-allow-origin'),origin);return {status:r.status,body:await r.json()};}
class Client {
  constructor(session){this.session=session;this.view=null;this.version=0;this.errors=[];this.signals=[];this.ws=new WebSocket(`${base.replace(/^http/,'ws')}/api/rooms/${session.code}/ws?id=${session.id}&token=${session.token}`);this.ws.addEventListener('message',e=>{if(e.data==='pong'){this.pong=true;return;}const m=JSON.parse(e.data);if(m.type==='state'){this.view=m.state;this.version++;}if(m.type==='error')this.errors.push(m.message);if(m.type==='signal')this.signals.push(m);});}
  async wait(predicate=()=>this.view){const limit=Date.now()+15000;while(!predicate()){if(Date.now()>limit)throw Error(`Timed out waiting for ${this.session.code} (${this.view?.phase}).`);await new Promise(r=>setTimeout(r,25));}return this.view;}
  async send(cmd,expectError=false){await this.wait(()=>this.ws.readyState===WebSocket.OPEN);const v=this.version,errors=this.errors.length;this.ws.send(JSON.stringify(cmd));await this.wait(()=>expectError?this.errors.length>errors:this.version>v);if(!expectError)assert.equal(this.errors.length,errors);return this.view;}
  close(){this.ws.close();}
}
const sessions=[];
try{
  if(origin){
    const options=await fetch(base+'/api/rooms',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
    assert.equal(options.status,204);assert.equal(options.headers.get('access-control-allow-origin'),origin);
    const invalid=await post('/api/rooms',{name:'',mode:'solo'});assert.equal(invalid.status,400);
    results.push('Pages JSON preflight and readable error responses use the exact allowed origin');
  }
  const created=await post('/api/rooms',{name:'网络测试甲',mode:'online'});assert.equal(created.status,201);const a=new Client(created.body);sessions.push(a);await a.wait();assert.equal(a.view.phase,'lobby');
  const transfer=await post('/api/rooms',{name:'房主离开测试',mode:'online'});const ta=new Client(transfer.body);sessions.push(ta);await ta.wait();const replacement=await post(`/api/rooms/${ta.session.code}/join`,{name:'继任房主'});const tb=new Client(replacement.body);sessions.push(tb);await tb.wait();ta.ws.send(JSON.stringify({type:'leave'}));await tb.wait(()=>tb.view.host===tb.session.id);assert.equal(tb.view.players.length,1);assert.equal(tb.view.players[0].seat,1);ta.close();tb.close();results.push('leaving lobby removes the seat and transfers host to the remaining human');
  const joined=await post(`/api/rooms/${created.body.code}/join`,{name:'网络测试乙'});assert.equal(joined.status,200);const b=new Client(joined.body);sessions.push(b);await b.wait();await a.wait(()=>a.view.players.length===2);
  const joined3=await post(`/api/rooms/${created.body.code}/join`,{name:'网络测试丙'});const c=new Client(joined3.body);sessions.push(c);await c.wait();
  await b.send({type:'start'},true);assert.equal(b.view.phase,'lobby');
  await a.send({type:'start'});await b.wait(()=>b.view.phase==='talk');await c.wait(()=>c.view.phase==='talk');
  assert.equal(a.view.players.length,8);assert.equal(a.view.players.filter(p=>p.animal!==null).length,1);assert.ok(!JSON.stringify(a.view).includes('credentials'));results.push('3 clients share one authoritative 8-seat room; non-host cannot start; roles filtered');
  await a.send({type:'message',target:b.session.id,text:'私有网络验证消息'});await b.wait(()=>b.view.log.some(l=>l.text==='私有网络验证消息'));assert.ok(!c.view.log.some(l=>l.text==='私有网络验证消息'));results.push('private message visible only to sender and recipient');
  await a.send({type:'signal',target:b.session.id,signal:{test:'forbidden'}},true);assert.equal(b.signals.length,0);results.push('voice signaling denied outside an authorized channel');
  await a.send({type:'voice',joined:true});await b.send({type:'voice',joined:true});a.ws.send(JSON.stringify({type:'signal',target:b.session.id,signal:{test:'authorized'}}));await b.wait(()=>b.signals.length===1);assert.equal(c.signals.length,0);results.push('voice signaling routes only between opted-in participants');
  for(const client of [a,b,c])await client.send({type:'ready'});await a.wait(()=>a.view.phase==='drop');
  await a.send({type:'drop',region:'forest'});await a.send({type:'ready'});assert.equal(b.view.players.find(p=>p.id===a.session.id).drop,null);await b.send({type:'drop',region:'river'});await b.send({type:'ready'});await c.send({type:'drop',region:'meadow'});await c.send({type:'ready'});await a.wait(()=>a.view.phase==='action');assert.equal(b.view.players.find(p=>p.id===a.session.id).drop,'forest');results.push('placement remains secret until all humans lock choices');
  await a.send({type:'move',region:'ruins'},true);await a.send({type:'move',region:'river'});assert.equal(a.view.me.location,'river');assert.ok(!('location' in b.view.players.find(p=>p.id===a.session.id)));results.push('invalid movement rejected; valid movement stays private');
  for(const client of [a,b,c])await client.send({type:'ready'});await a.wait(()=>a.view.phase==='traces');assert.equal(a.view.traces.ruins,null);
  for(const client of [a,b,c])await client.send({type:'ready'});await a.wait(()=>a.view.phase==='call');await a.send({type:'call',target:b.session.id});await b.send({type:'call-answer',accept:true});await a.wait(()=>a.view.call?.accepted);assert.equal(a.view.me.called,true);assert.equal(b.view.me.called,true);await a.send({type:'hangup'});await c.wait(()=>c.view.callIndex===2);await c.send({type:'ready'});await a.wait(()=>a.view.phase==='food');results.push('ordered accepted calls consume both quotas and progress correctly');
  for(const client of [a,b,c]){await client.send({type:'food',choice:'skip'});await client.send({type:'ready'});}await a.wait(()=>a.view.phase==='settle');results.push('simultaneous food choices resolve consistently for all clients');
  const old=a.view;const reconnect=new Client(a.session);sessions.push(reconnect);await reconnect.wait();assert.deepEqual(reconnect.view.me,old.me);results.push('reconnect restores persisted private state');
  const forbidden=await fetch(base+'/api/rooms',{method:'POST',headers:{origin:'https://evil.invalid','content-type':'application/json'},body:JSON.stringify({name:'伪造',mode:'solo'})});assert.equal(forbidden.status,403);results.push('cross-origin mutation rejected');
  const bad=await new Promise((resolve,reject)=>{const req=(base.startsWith('https')?httpsRequest:httpRequest)(`${base}/api/rooms/${a.session.code}/ws?id=${a.session.id}&token=bad`,{headers:{Upgrade:'websocket',Connection:'Upgrade','Sec-WebSocket-Key':randomBytes(16).toString('base64'),'Sec-WebSocket-Version':'13'}},r=>{resolve(r.statusCode);r.resume();});req.on('error',reject);req.end();});assert.equal(bad,401);results.push('invalid seat token rejected');
  if(origin){
    assert.equal(await socketStatus(a.session,'https://evil.invalid'),403);
    assert.equal(await socketStatus(a.session,origin),101);
    results.push('WebSocket handshake accepts Pages origin and rejects untrusted origins');
  }
  const solo=await post('/api/rooms',{name:'七回合验证',mode:'solo'});const d=new Client(solo.body);sessions.push(d);await d.wait();await d.send({type:'start',animal:'deer'});assert.equal(d.view.me.animal,'deer');let steps=0;
  while(d.view.phase!=='finished'&&steps++<85){
    if(d.view.me.alive&&d.view.phase==='drop'){const r=Object.keys(d.view.resources).find(r=>d.view.resources[r]>0);await d.send({type:'drop',region:r});}
    if(d.view.me.alive&&d.view.phase==='food')await d.send({type:'food',choice:'forage'});
    await d.send({type:'ready'});
    // Real users cannot exceed the production rate limit; keep this stress run bounded.
    await new Promise(r=>setTimeout(r,55));
  }
  assert.equal(d.view.phase,'finished');assert.equal(d.view.round,7);assert.ok(d.view.players.every(p=>p.animal!==null&&Number.isFinite(p.score)));results.push('complete solo 7-round game reaches final revealed scoreboard over live WebSocket');
  fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/network-results.json',JSON.stringify({base,date:new Date().toISOString(),checks:results,finalRound:d.view.round,players:d.view.players},null,2));
  console.log(JSON.stringify({base,passed:results.length,checks:results},null,2));
}finally{for(const c of sessions)c.close();}
