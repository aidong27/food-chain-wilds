import { DurableObject } from 'cloudflare:workers';
import { timingSafeEqual } from 'node:crypto';
import { addPlayer, advance, command, createGame, view, type Command, type Game } from '../src/engine';
import { originPolicy, preflight } from './cors';

interface StoredRoom { game: Game; credentials: Record<string,string>; expires: number }
type Attachment = { id: string; window: number; count: number };
const json = (value: unknown, status = 200) => Response.json(value, {status,headers:{'Cache-Control':'no-store'}});
async function hash(token: string) { const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)); return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function cleanName(value: unknown) { if(typeof value!=='string' || !value.trim() || [...value].length>12)throw Error('请输入 1–12 字的玩家代号。');return value.trim().replace(/[\u0000-\u001f\u007f]/g,''); }
async function readBody(request: Request): Promise<Record<string,unknown>> {
  if(Number(request.headers.get('content-length'))>2048)throw Error('请求过长。');
  const reader=request.body?.getReader();if(!reader)return{};let size=0;const parts:Uint8Array[]=[];
  while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048){await reader.cancel();throw Error('请求过长。');}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  const obj:unknown=JSON.parse(new TextDecoder().decode(bytes));if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('无效请求。');return obj as Record<string,unknown>;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
    const cors=originPolicy(request,env.PAGES_ORIGIN);
    if(!cors.allowed)return json({error:'不允许跨站请求。'},403);
    if(request.method==='OPTIONS')return preflight(request,cors.headers);
    const respond=(value:unknown,status=200)=>Response.json(value,{status,headers:{...cors.headers,'Cache-Control':'no-store'}});
    if(url.pathname==='/api/health')return respond({ok:true,game:'food-chain',version:'1.0.0'});
    try {
      if(url.pathname==='/api/rooms' && request.method==='POST'){
        const data=await readBody(request);const name=cleanName(data.name);const mode=data.mode==='solo'?'solo':'online';
        for(let tries=0;tries<4;tries++){
          const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const bytes=crypto.getRandomValues(new Uint8Array(6));const code=[...bytes].map(b=>chars[b%chars.length]).join('');
          const result=await env.ROOMS.getByName(code).create(code,mode,name);if(result)return respond(result,201);
        }return respond({error:'房间暂时繁忙，请重新创建。'},503);
      }
      const match=url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/(join|ws)$/);
      if(!match)return respond({error:'找不到这个地址。'},404);
      const stub=env.ROOMS.getByName(match[1]);
      if(match[2]==='join' && request.method==='POST'){const data=await readBody(request);return respond(await stub.join(cleanName(data.name)));}
      if(match[2]==='ws' && request.method==='GET')return stub.fetch(request);
      return respond({error:'请求方式不支持。'},405);
    }catch(e){return respond({error:e instanceof Error?e.message:'请求未能完成。'},400);}
  },
} satisfies ExportedHandler<Env>;

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env){
    super(ctx,env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  }
  private load():StoredRoom|null{
    const row=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM room WHERE id=1').toArray()[0];return row?JSON.parse(row.data):null;
  }
  private save(room:StoredRoom){this.ctx.storage.sql.exec('INSERT INTO room (id,data) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',JSON.stringify(room));}
  private async schedule(room:StoredRoom){
    const next=room.game.deadline||room.expires;
    await this.ctx.storage.setAlarm(Math.max(Date.now()+100,Math.min(next,room.expires)));
  }
  async create(code:string,mode:'solo'|'online',name:string){
    const token=crypto.randomUUID()+crypto.randomUUID();const digest=await hash(token);
    const existing=this.load();if(existing)return null;
    const game=createGame(code,mode);const id=crypto.randomUUID();addPlayer(game,id,name);
    const room:StoredRoom={game,credentials:{[id]:digest},expires:Date.now()+24*60*60*1000};this.save(room);await this.schedule(room);
    return {code,id,token};
  }
  async join(name:string){
    const token=crypto.randomUUID()+crypto.randomUUID();const digest=await hash(token);
    const room=this.load();if(!room||room.expires<=Date.now())throw Error('房间不存在或已过期，请检查房间码。');if(room.game.mode==='solo')throw Error('这是单人练习房间，请创建联机房间邀请朋友。');
    const id=crypto.randomUUID();addPlayer(room.game,id,name);room.credentials[id]=digest;this.save(room);this.broadcast(room.game);return {code:room.game.code,id,token};
  }
  async fetch(request:Request):Promise<Response>{
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'需要实时连接。'},426);
    const url=new URL(request.url);const id=url.searchParams.get('id')||'';const token=url.searchParams.get('token')||'';
    if(token.length>200)return json({error:'无效会话。'},401);
    const digest=await hash(token);const room=this.load();
    if(!room||room.expires<=Date.now())return json({error:'房间已过期。'},404);
    const stored=room.credentials[id];
    if(!stored || !timingSafeEqual(new TextEncoder().encode(stored),new TextEncoder().encode(digest)))return json({error:'会话验证失败。'},401);
    // One live connection per seat prevents duplicated commands during a reconnect.
    for(const ws of this.ctx.getWebSockets(id)){try{ws.close(4001,'这个席位已在另一个连接中打开。');}catch{/* already closed */}}
    const pair=new WebSocketPair();const [client,server]=Object.values(pair);
    this.ctx.acceptWebSocket(server,[id]);server.serializeAttachment({id,window:Date.now(),count:0} satisfies Attachment);
    server.send(JSON.stringify({type:'state',state:view(room.game,id)}));
    return new Response(null,{status:101,webSocket:client});
  }
  private broadcast(game:Game){for(const ws of this.ctx.getWebSockets()){const a=ws.deserializeAttachment() as Attachment;try{ws.send(JSON.stringify({type:'state',state:view(game,a.id)}));}catch{/* disconnected clients recover from persisted state */}}}
  async webSocketMessage(ws:WebSocket,message:string|ArrayBuffer){
    const a=ws.deserializeAttachment() as Attachment;
    try{
      if(typeof message!=='string'||message.length>18000)throw Error('消息格式无效。');
      const now=Date.now();if(now-a.window>1000){a.window=now;a.count=0;}a.count++;ws.serializeAttachment(a);if(a.count>30)throw Error('操作过快，请稍候。');
      const parsed:unknown=JSON.parse(message);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('无效操作。');
      const msg=parsed as Command & {signal?:unknown};if(typeof msg.type!=='string')throw Error('无效操作。');
      const room=this.load();if(!room||room.expires<=now){ws.close(4004,'房间已过期。');return;}
      if(msg.type==='leave'){
        const p=room.game.players.find(p=>p.id===a.id);if(!p)throw Error('玩家不存在。');
        if(room.game.phase==='lobby'){
          room.game.players=room.game.players.filter(q=>q.id!==a.id);
          room.game.players.forEach((q,i)=>{q.seat=i+1;});
        }else{p.bot=true;p.voice=false;p.ready=true;}
        if(room.game.host===a.id)room.game.host=room.game.players.find(q=>!q.bot)?.id||'';
        delete room.credentials[a.id];this.save(room);this.broadcast(room.game);ws.close(4001,'已离开房间。');return;
      }
      if(msg.type==='signal'){
        const g=room.game;const p=g.players.find(p=>p.id===a.id);const q=g.players.find(p=>p.id===msg.target);
        const allowed=p?.alive && q?.alive && ((g.phase==='talk'&&p.voice&&q.voice) || (g.phase==='call'&&g.call?.accepted&&[g.call.from,g.call.to].includes(p.id)&&[g.call.from,g.call.to].includes(q.id)&&p.id!==q.id));
        if(!allowed)throw Error('你们不在同一个语音频道。');
        for(const target of this.ctx.getWebSockets(q!.id))target.send(JSON.stringify({type:'signal',from:a.id,signal:msg.signal}));return;
      }
      if(message.length>2048)throw Error('操作数据过长。');
      // Reject malformed fields before rule evaluation or any state persistence.
      for(const key of ['region','target','text','choice','animal'] as const)if(msg[key]!==undefined&&typeof msg[key]!=='string')throw Error('操作参数格式无效。');
      if(room.game.deadline&&room.game.deadline<=now){advance(room.game);this.save(room);this.broadcast(room.game);await this.schedule(room);return;}
      command(room.game,a.id,msg);this.save(room);this.broadcast(room.game);await this.schedule(room);
    }catch(e){ws.send(JSON.stringify({type:'error',message:e instanceof Error?e.message:'操作未能完成。'}));}
  }
  async webSocketClose(ws:WebSocket,code:number){
    const a=ws.deserializeAttachment() as Attachment;const room=this.load();
    if(room && !this.ctx.getWebSockets(a.id).some(other=>other!==ws)){
      const p=room.game.players.find(p=>p.id===a.id);if(p?.voice){p.voice=false;this.save(room);this.broadcast(room.game);}
    }
    try{ws.close(code);}catch{/* closed */}
  }
  async webSocketError(ws:WebSocket){await this.webSocketClose(ws,1011);}
  async alarm(){
    const room=this.load();if(!room)return;
    if(Date.now()>=room.expires){for(const ws of this.ctx.getWebSockets())ws.close(4004,'房间已到期。');await this.ctx.storage.deleteAll();return;}
    if(room.game.deadline&&room.game.deadline<=Date.now()){advance(room.game);this.save(room);this.broadcast(room.game);}
    await this.schedule(room);
  }
}
