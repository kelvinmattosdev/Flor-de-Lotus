import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Execute the real shared lifecycle AND the real storefront menu-open handler.
// Only native DOM primitives are stubbed. In particular, close() queues its "close"
// event instead of dispatching synchronously, so an old event can reach a new opening.
const source=readFileSync(new URL('../src/ui/dialogs.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/m,'').replace(/\bexport /g,'');
const storefront=readFileSync(new URL('../src/ui/storefront.js',import.meta.url),'utf8');
const start=storefront.indexOf("$('#menu-toggle').addEventListener('click', event => {");
const end=storefront.indexOf('\n});',start);
assert.ok(start>=0&&end>start,'The regression must execute the actual menu controller.');
const controller=storefront.slice(start,end+4);

function environment(initialOverflow='') {
  const queued=[],dialogs=[],calls={reveal:0,cancel:0};
  const document={body:{style:{overflow:initialOverflow}},activeElement:null};
  function control(id) {
    const handlers=new Map();
    return {
      id,isConnected:true,attributes:{},
      setAttribute(name,value){this.attributes[name]=String(value);},
      getAttribute(name){return this.attributes[name]??null;},
      focus(){document.activeElement=this;},
      getClientRects(){return [{}];},
      closest(selector){return selector==='[data-close]'&&this.isClose?this:null;},
      addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);},
      click(){for(const fn of handlers.get('click')||[])fn({currentTarget:this,target:this});}
    };
  }
  const toggle=control('menu-toggle');
  toggle.setAttribute('aria-expanded','false');
  function dialog(id) {
    const handlers=new Map(),first=control(`${id}-close`),last=control(`${id}-last`);
    first.isClose=true;
    const d={
      id,open:false,dataset:{},scrollTop:0,first,last,
      addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);},
      emit(type,event={}){for(const fn of handlers.get(type)||[])fn(event);},
      showModal(){if(this.open)throw Error('Dialog already open');this.open=true;},
      close(){if(!this.open)return;this.open=false;queued.push(()=>this.emit('close'));},
      querySelector(selector){return selector==='[data-initial-focus]'?null:first;},
      querySelectorAll(){return [first,last];},
      getBoundingClientRect(){return {left:0,right:400,top:0,bottom:800};}
    };
    first.click=()=>d.emit('click',{target:first});
    dialogs.push(d);return d;
  }
  const menu=dialog('menu-dialog'),cart=dialog('cart-dialog');
  document.querySelector=selector=>selector==='dialog[open]'?dialogs.find(d=>d.open)||null:selector==='#menu-toggle'?toggle:selector==='#menu-dialog'?menu:null;
  document.querySelectorAll=()=>dialogs.filter(d=>!d.dataset.dialogWired);
  const context={
    document,$:selector=>document.querySelector(selector),
    // Existing immediate-close assertions exercise Reduced/fallback semantics.
    // Full's newly approved finite visual closing phase is covered separately below.
    panelMotion:(dialog,closing)=>{if(!closing)calls.reveal++;},cancelMotion:()=>{calls.cancel++;},
    onMotionChange:()=>{},getComputedStyle:()=>({transform:'none'}),setTimeout,clearTimeout
  };
  runInNewContext(`${source}
    const menuDialog=document.querySelector('#menu-dialog');
    ${controller}
    globalThis.lifecycle={openDialog,closeDialog,initDialogs};
    initDialogs();
  `,context,{timeout:1000});
  return {document,toggle,menu,cart,calls,api:context.lifecycle,flush(){while(queued.length)queued.shift()();}};
}

test('QA-003-01: an old native close event cannot publish collapsed for a reopened menu',()=>{
  const e=environment();
  e.toggle.click();e.menu.first.click();e.toggle.click(); // same JS turn, no close events drained yet
  assert.equal(e.menu.open,true);
  assert.equal(e.toggle.getAttribute('aria-expanded'),'true');
  e.flush(); // the earlier close reaches the current opening
  assert.equal(e.menu.open,true);
  assert.equal(e.toggle.getAttribute('aria-expanded'),'true');
  assert.equal(e.document.body.style.overflow,'hidden');
  assert.equal(e.document.activeElement,e.menu.first);
  e.menu.first.click();
  assert.equal(e.menu.open,false);
  assert.equal(e.toggle.getAttribute('aria-expanded'),'false','Immediate close must expose current state too.');
  assert.equal(e.document.body.style.overflow,'');
  e.flush();
  assert.equal(e.toggle.getAttribute('aria-expanded'),'false');
  assert.equal(e.document.activeElement,e.toggle);
});

test('QA-003-01: menu replacement reports collapsed but old close never unlocks the active cart',()=>{
  const e=environment('clip');
  e.toggle.click();
  e.api.openDialog(e.cart);
  assert.equal(e.menu.open,false);
  assert.equal(e.toggle.getAttribute('aria-expanded'),'false');
  e.flush();
  assert.equal(e.cart.open,true);
  assert.equal(e.document.body.style.overflow,'hidden');
  e.api.closeDialog(e.cart);
  assert.equal(e.document.body.style.overflow,'clip');
  assert.equal(e.document.activeElement,e.toggle);
  e.flush();
  assert.equal(e.document.body.style.overflow,'clip');
});

test('QA-003-01: Escape, focus trap and repeated lifecycle retain real state and prior body overflow',()=>{
  const e=environment();
  e.api.initDialogs(); // listener registration remains idempotent
  for(let i=0;i<4;i++){
    e.toggle.click();
    let prevented=false;
    e.menu.last.focus();
    e.menu.emit('keydown',{key:'Tab',shiftKey:false,preventDefault(){prevented=true;}});
    assert.equal(prevented,true);
    assert.equal(e.document.activeElement,e.menu.first);
    let canceled=false;
    e.menu.emit('cancel',{preventDefault(){canceled=true;}});
    assert.equal(canceled,true);
    assert.equal(e.menu.open,false);
    assert.equal(e.document.activeElement,e.toggle);
    assert.equal(e.document.body.style.overflow,'');
    e.flush();
    assert.equal(e.toggle.getAttribute('aria-expanded'),'false');
  }
  assert.equal(e.calls.reveal,4,'Animations are not removed to repair ARIA.');
});
