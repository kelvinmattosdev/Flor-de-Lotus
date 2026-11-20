import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const prepaint=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1];
const moduleSource=readFileSync(new URL('../src/ui/section-navigation.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/export /g,'');
const KEY='flor-de-lotus:section-entry:v1';
function fixture({entry=true,choice='full',type='navigate',referrer='http://test.local/produto.html?id=FDL-CRAFT-MORANGO',storageDenied=false}={}) {
  const listeners=new Map(),frames=new Map(),calls=[],data=new Map(entry?[[KEY,'#sebo']]:[]);
  const root={dataset:{motionEffective:choice}};
  const location={href:'http://test.local/index.html#sebo',origin:'http://test.local',pathname:'/index.html',search:'',hash:'#sebo'};
  const heading={id:'sebo-title',focus(){calls.push('focus');document.activeElement=heading;}};
  const target={querySelector:()=>heading,getBoundingClientRect:()=>({top:2000-context.scrollY}),scrollIntoView:()=>calls.push('nativeFallback')};
  let resolveFonts;
  const fonts=new Promise(resolve=>{resolveFonts=resolve;});
  const document={
    documentElement:root,body:{dataset:{page:'home'}},readyState:'loading',referrer,
    fonts:{ready:fonts},activeElement:{tagName:'BODY'},
    getElementById:id=>id==='sebo'?target:null,
    querySelector:s=>s==='.site-header'?{getBoundingClientRect:()=>({height:119})}:null,
    addEventListener:(name,fn)=>{const k='document:'+name;listeners.set(k,[...(listeners.get(k)||[]),fn]);}
  };
  root.scrollHeight=4000;
  const sessionStorage={getItem:k=>{if(storageDenied)throw Error('Denied');return data.get(k)||null;},setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const history={state:null,replaceState(state,unused,url){calls.push({replace:url,ready:document.readyState});history.state=state;const u=new URL(url,location.href);Object.assign(location,{href:u.href,hash:u.hash});},pushState(){}};
  const context={window:null,document,location,history,sessionStorage,URL,innerHeight:900,scrollY:0,
    performance:{now:()=>0,getEntriesByType:()=>[{type}]},
    requestAnimationFrame:fn=>{const n=frames.size+1;frames.set(n,fn);return n;},cancelAnimationFrame:id=>frames.delete(id),
    scrollTo:({top})=>{context.scrollY=top;calls.push({scroll:top});},
    reducedMotion:()=>choice!=='full',onMotionChange:()=>{},closeDialog:()=>Promise.resolve(true)};
  context.window=context;
  context.addEventListener=(name,fn)=>listeners.set(name,[...(listeners.get(name)||[]),fn]);
  const fire=name=>{for(const fn of listeners.get(name)||[])fn({});};
  return{context,document,root,data,location,history,calls,frames,heading,resolveFonts,fire,
    prepaint:()=>runInNewContext(prepaint,context),
    init:()=>runInNewContext(moduleSource+'\ninitSectionNavigation();',context),
    frame:now=>{const list=[...frames.values()];frames.clear();for(const fn of list)fn(now);}};
}
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('007: actual prepaint consumes only explicit PDP intent; direct/reload/Reduced stay native',()=>{
  const f=fixture();f.prepaint();
  assert.equal(f.data.has(KEY),false);assert.equal(f.location.hash,'');assert.equal(f.root.dataset.sectionEntry,'#sebo');
  for(const options of [{entry:false},{type:'reload'},{type:'back_forward'},{choice:'reduced'}]){
    const n=fixture(options);n.prepaint();assert.equal(n.location.hash,'#sebo');assert.equal(n.root.dataset.sectionEntry,undefined);
  }
});
test('007: actual controller holds fragment through native load, then scrolls progressively and focuses once',async()=>{
  const f=fixture();f.prepaint();f.init();f.resolveFonts();await settle();
  assert.equal(f.location.hash,'','No fragment restoration while native load can still install its own anchor.');
  assert.equal(f.calls.filter(x=>x==='focus').length,0);
  f.document.readyState='complete';f.fire('load');await settle();f.frame(16);await settle();
  assert.equal(f.location.hash,'#sebo');assert.equal(f.calls.filter(x=>x==='nativeFallback').length,0);
  f.frame(100);f.frame(200);f.frame(400);f.frame(800);
  assert.ok(new Set(f.calls.filter(x=>x?.scroll>0&&x.scroll<1869).map(x=>x.scroll)).size>=2);
  assert.equal(f.document.activeElement,f.heading);assert.equal(f.calls.filter(x=>x==='focus').length,1);
});
test('007: wheel while fresh entry waits cancels journey and final focus; missing module has native fallback',async()=>{
  const f=fixture();f.prepaint();f.init();f.fire('wheel');f.resolveFonts();f.document.readyState='complete';f.fire('load');await settle();f.frame(16);await settle();f.frame(800);
  assert.equal(f.calls.filter(x=>x==='focus'||x?.scroll!==undefined).length,0);
  const fallback=fixture();fallback.prepaint();fallback.document.readyState='complete';fallback.fire('load');
  assert.equal(fallback.location.hash,'#sebo');assert.ok(fallback.calls.includes('nativeFallback'));
});
test('010: direct/reloaded home fragment has no scripted scroll or focus',async()=>{
  for(const type of ['navigate','reload','back_forward']){
    const f=fixture({entry:false,type});f.prepaint();f.init();f.resolveFonts();f.document.readyState='complete';f.fire('load');await settle();f.frame(16);f.frame(800);
    assert.equal(f.location.hash,'#sebo');assert.equal(f.calls.filter(c=>c==='focus'||c?.scroll!==undefined).length,0);
  }
});
test('010: explicit Reduced cross-page intent keeps native hash and scroll, focuses once only',async()=>{
  const f=fixture({choice:'reduced'});f.prepaint();assert.equal(f.location.hash,'#sebo');f.init();f.resolveFonts();f.document.readyState='complete';f.fire('load');await settle();f.frame(16);
  assert.equal(f.calls.filter(c=>c?.scroll!==undefined).length,0);assert.equal(f.calls.filter(c=>c==='focus').length,1);
  assert.equal(f.data.has(KEY),false);
});
test('010: Reduced uses one-use validated intent, not external/referrer/reload/storage failures',async()=>{
  for(const choice of ['full','reduced'])for(const options of [{referrer:'http://elsewhere.example/produto.html'},{referrer:'http://test.local/unrelated.html'},{referrer:''},{storageDenied:true},{type:'reload'}]){
    const f=fixture({choice,...options});f.prepaint();f.init();f.resolveFonts();f.document.readyState='complete';f.fire('load');await settle();f.frame(16);f.frame(800);
    assert.equal(f.location.hash,'#sebo');assert.equal(f.calls.filter(c=>c==='focus'||c?.scroll!==undefined).length,0);
  }
  const cancelled=fixture({choice:'reduced'});cancelled.prepaint();cancelled.init();cancelled.fire('pointerdown');cancelled.resolveFonts();cancelled.document.readyState='complete';cancelled.fire('load');await settle();cancelled.frame(16);
  assert.equal(cancelled.calls.filter(c=>c==='focus').length,0);
});
