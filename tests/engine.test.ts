import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, advance, command, createGame, pay, settleFood, start, view, type Game, type Player } from '../src/engine';
import { REGIONS, SPECIES, species, type SpeciesId } from '../src/data';
function setup(role:SpeciesId='wolf') { const g=createGame('TEST01','solo',123);addPlayer(g,'human','测试玩家');start(g,role);return g; }
function asRole(p:Player, id:SpeciesId){p.animal=id;p.hp=species(id).hp;p.sp=species(id).sp;p.alive=true;}
function isolated(g:Game){g.players.forEach(p=>{p.location='ruins';p.food='skip';p.bot=false;});}
test('eight distinct animals and exact seven-round terminal state',()=>{
  const g=setup();assert.equal(new Set(g.players.map(p=>p.animal)).size,8);
  let steps=0;while(g.phase!=='finished' && steps++<100){advance(g);}assert.equal(g.phase,'finished');assert.equal(g.round,7);assert.ok(steps<=60);
});
test('region adjacency is symmetric, connected, and has genuinely hidden regions',()=>{
  for(const r of REGIONS){assert.ok(r.adjacent.length<5);for(const id of r.adjacent)assert.ok((REGIONS.find(q=>q.id===id)!.adjacent as readonly string[]).includes(r.id));}
  const seen=new Set<string>(['forest']);for(let i=0;i<6;i++)for(const r of REGIONS)if(seen.has(r.id))r.adjacent.forEach(a=>seen.add(a));assert.equal(seen.size,6);
});
test('ordinary food restores SP and never restores HP',()=>{
  const g=setup('deer');isolated(g);const p=g.players[0];p.location='forest';p.hp=2;p.sp=1;p.food='forage';g.resources.forest=1;settleFood(g);assert.equal(p.hp,2);assert.equal(p.sp,3);assert.equal(p.fed,true);assert.equal(g.resources.forest,0);
});
test('overdraw restores half then pays action and can kill before acting',()=>{
  const g=setup('wolf');const p=g.players[0];p.sp=0;p.hp=3;assert.equal(pay(g,p),true);assert.equal(p.hp,2);assert.equal(p.sp,1);
  p.hp=1;p.sp=0;assert.equal(pay(g,p),false);assert.equal(p.alive,false);assert.equal(p.hp,0);assert.equal(g.bodies.length,1);
});
test('hiding erases local traces but cannot stop predation',()=>{
  const g=setup('rabbit');isolated(g);const rabbit=g.players[0],wolf=g.players[1];asRole(wolf,'wolf');rabbit.location=wolf.location='forest';g.traces={forest:[rabbit.id],river:[rabbit.id]};g.phase='action';rabbit.ready=false;
  command(g,rabbit.id,{type:'hide'});assert.deepEqual(g.traces.forest,[]);assert.deepEqual(g.traces.river,[rabbit.id]);
  wolf.food='hunt';wolf.target=rabbit.id;settleFood(g);assert.equal(rabbit.hp,2);assert.equal(wolf.fed,true);
});
test('movement is adjacent only and leaves departure and arrival traces',()=>{
  const g=setup();const p=g.players[0];g.phase='action';p.location='forest';p.ready=false;
  assert.throws(()=>command(g,p.id,{type:'move',region:'ruins'}),/相邻/);assert.equal(p.sp,4);
  command(g,p.id,{type:'move',region:'river'});assert.ok(g.traces.forest.includes(p.id));assert.ok(g.traces.river.includes(p.id));assert.equal(p.sp,3);assert.equal(p.actions,1);
});
test('server view does not leak other roles, hidden locations, choices, SP, HP or remote traces',()=>{
  const g=setup();isolated(g);const p=g.players[0];p.location='forest';g.phase='traces';g.players[1].location='ruins';g.traces={ruins:['secret-player'],river:['visible-trace']};
  const v=view(g,p.id);assert.equal(v.traces.ruins,null);assert.deepEqual(v.traces.river,['visible-trace']);assert.equal(v.players[1].animal,null);assert.equal(v.players[1].hp,null);assert.ok(!('location' in v.players[1]));assert.ok(!('food' in v.players[1]));assert.ok(!('sp' in v.players[1]));assert.ok(!JSON.stringify(v).includes('secret-player'));
});
test('initial placements stay secret until every human locks in',()=>{
  const g=createGame('TEST02','online',5);addPlayer(g,'a','甲');addPlayer(g,'b','乙');start(g);advance(g);
  command(g,'a',{type:'drop',region:'forest'});command(g,'a',{type:'ready'});assert.equal(g.phase,'drop');assert.equal(view(g,'b').players[0].drop,null);
  command(g,'b',{type:'drop',region:'river'});command(g,'b',{type:'ready'});assert.equal(g.phase,'action');assert.equal(view(g,'b').players[0].drop,'forest');
});
test('only food attempts expose actors, locally, including failed attempts',()=>{
  const g=setup('deer');isolated(g);const[a,b,c]=g.players;a.location=b.location='forest';c.location='meadow';a.food='forage';g.resources.forest=0;g.phase='food';settleFood(g);
  assert.ok(view(g,b.id).log.some(l=>l.text.includes(`${a.name} 在雾松林进行了`)));assert.ok(!view(g,c.id).log.some(l=>l.text.includes(`${a.name} 在雾松林进行了`)));assert.ok(!view(g,a.id).log.some(l=>l.text.includes(`${b.name} 在寂石荒地进行了`)));
});
test('wrong targeted prey fails, guard reduces damage and boost applies once',()=>{
  const g=setup('wolf');isolated(g);const[a,b]=g.players;asRole(b,'snake');a.location=b.location='forest';a.food='hunt';a.target=b.id;settleFood(g);assert.equal(a.fed,false);assert.equal(b.hp,3);
  asRole(b,'deer');b.hunger=0;b.guard=true;a.boost=1;a.sp=4;a.fed=false;settleFood(g);assert.equal(b.hp,3);assert.equal(a.boost,0);assert.equal(a.fed,true);
});
test('scarce resource has one winner and initiative rotates',()=>{
  const g=setup('deer');isolated(g);const[a,b]=g.players;asRole(b,'boar');a.location=b.location='forest';a.food=b.food='forage';g.resources.forest=1;settleFood(g);assert.equal(a.fed,true);assert.equal(b.fed,false);
  g.round=2;g.resources.forest=1;a.fed=b.fed=false;a.sp=b.sp=4;settleFood(g);assert.equal(a.fed,false);assert.equal(b.fed,true);
});
test('private messages are only delivered to sender/recipient and quotas count codepoints',()=>{
  const g=createGame('MSG001','online',2);addPlayer(g,'a','甲');addPlayer(g,'b','乙');addPlayer(g,'c','丙');start(g);
  command(g,'a',{type:'message',target:'b',text:'只有你知道的线索'});assert.ok(view(g,'a').log.some(l=>l.text==='只有你知道的线索'));assert.ok(view(g,'b').log.some(l=>l.text==='只有你知道的线索'));assert.ok(!view(g,'c').log.some(l=>l.text==='只有你知道的线索'));
  command(g,'a',{type:'message',target:'b',text:'🌲'.repeat(50)});assert.throws(()=>command(g,'a',{type:'message',target:'b',text:'字'.repeat(51)}),/50/);
  for(let i=0;i<3;i++)command(g,'a',{type:'message',target:'b',text:'额度'});assert.throws(()=>command(g,'a',{type:'message',target:'b',text:'第六条'}),/5/);
  command(g,'a',{type:'message',target:'all',text:'公告'});assert.throws(()=>command(g,'a',{type:'message',target:'all',text:'第二条'}),/额度/);
});
test('hunger runs in short cycles and food resets the cycle',()=>{
  const g=setup('deer');isolated(g);const p=g.players[0];settleFood(g);assert.equal(p.hp,5);assert.equal(p.hunger,1);settleFood(g);assert.equal(p.hp,4);assert.equal(p.hunger,2);settleFood(g);assert.equal(p.hp,3);p.location='forest';p.food='forage';g.resources.forest=1;settleFood(g);assert.equal(p.hunger,0);assert.equal(p.hp,3);
});
test('calls are ordered, require acceptance and consume both participant quotas',()=>{
  const g=createGame('CALL01','online',2);addPlayer(g,'a','甲');addPlayer(g,'b','乙');addPlayer(g,'c','丙');start(g);g.phase='traces';advance(g);assert.equal(g.phase,'call');assert.equal(g.callIndex,0);
  assert.throws(()=>command(g,'b',{type:'call',target:'a'}));command(g,'a',{type:'call',target:'b'});assert.equal(g.players[0].called,false);command(g,'b',{type:'call-answer',accept:true});assert.equal(g.players[0].called,true);assert.equal(g.players[1].called,true);assert.ok(g.deadline>Date.now()+28000);
  command(g,'a',{type:'hangup'});assert.equal(g.callIndex,2);assert.equal(g.call,null);
});
test('dead players cannot act or message and retain only their own visibility',()=>{
  const g=setup();const p=g.players[0];p.alive=false;p.hp=0;assert.throws(()=>command(g,p.id,{type:'message',target:'all',text:'泄露信息'}));g.phase='action';assert.throws(()=>command(g,p.id,{type:'move',region:'river'}));
  assert.equal(view(g,p.id).players.filter(q=>q.animal!==null).length,1);
});
test('untrusted clients cannot forage as predators, add bots after start or change locked choices',()=>{
  const g=setup();const p=g.players[0];g.phase='food';assert.throws(()=>command(g,p.id,{type:'food',choice:'forage'}));assert.throws(()=>command(g,p.id,{type:'bots'}));
  g.phase='drop';p.ready=true;assert.throws(()=>command(g,p.id,{type:'drop',region:'river'}));
});
test('rabbit jumps without traces, crow only obtains requested traces, fox gets one scoped message',()=>{
  const g=setup('rabbit');isolated(g);const p=g.players[0];p.location='forest';g.phase='action';p.ready=false;g.traces={forest:[p.id],river:[p.id],ruins:[p.id]};command(g,p.id,{type:'skill',region:'river'});assert.equal(p.location,'river');assert.deepEqual(g.traces.forest,[]);assert.deepEqual(g.traces.river,[]);assert.deepEqual(g.traces.ruins,[p.id]);
  asRole(p,'crow');p.skillUsed=false;p.actions=2;command(g,p.id,{type:'skill',region:'ruins'});assert.ok(view(g,p.id).log.some(l=>l.text.includes('俯瞰 寂石荒地')));
  asRole(p,'fox');p.skillUsed=false;p.actions=2;g.players[1].location=p.location;command(g,g.players[1].id,{type:'message',target:g.players[2].id,text:'窃听样本'});command(g,p.id,{type:'skill'});assert.ok(view(g,p.id).log.some(l=>l.text.includes('窃听样本')));assert.ok(!view(g,g.players[3].id).log.some(l=>l.text.includes('窃听样本')));
});
test('all roles finish playable full games without invalid resources across seeded runs',()=>{
  const summary:Record<string,{survived:number;games:number}>={};
  for(const role of SPECIES)for(let seed=1;seed<=25;seed++){
    const g=createGame('SIM001','solo',seed);addPlayer(g,'h','玩家');start(g,role.id);const p=g.players[0];let steps=0;
    while(g.phase!=='finished'&&steps++<80){
      if(p.alive&&g.phase==='drop'){const fertile=REGIONS.filter(r=>g.resources[r.id]>0);command(g,p.id,{type:'drop',region:fertile[seed%fertile.length].id});}
      if(p.alive&&g.phase==='food')command(g,p.id,{type:'food',choice:role.diet==='hunt'?'hunt':'forage'});
      command(g,p.id,{type:'ready'});
      for(const q of g.players){assert.ok(q.sp>=0&&q.sp<=species(q.animal).sp);assert.ok(q.hp>=0&&q.hp<=species(q.animal).hp);}
      assert.ok(Object.values(g.resources).every(x=>x>=0));
    }
    assert.equal(g.phase,'finished');assert.equal(g.round,7);assert.ok(g.players.every(q=>Number.isFinite(q.score)));
    summary[role.id]||={survived:0,games:0};summary[role.id].games++;summary[role.id].survived+=Number(p.alive);
  }
  console.log('200-game baseline (simple forage/hunt strategy):',JSON.stringify(summary));
});
