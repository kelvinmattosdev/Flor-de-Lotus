import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {MOTION_KEY,motionChoice,effectiveMotion} from '../src/domain/motion-preference.js';

test('004: Auto respects real system preference; only explicit stored Full overrides reduce',()=>{
  assert.equal(MOTION_KEY,'flor-de-lotus:motion:v1');
  for(const bad of [null,undefined,'','FULL','garbage',{},'12345-678'])assert.equal(motionChoice(bad),'auto');
  for(const os of [true,false]){
    assert.equal(effectiveMotion('auto',os),os?'reduced':'full');
    assert.equal(effectiveMotion('full',os),'full');
    assert.equal(effectiveMotion('reduced',os),'reduced');
    assert.equal(effectiveMotion('invalid',os),os?'reduced':'full');
  }
});
test('004: both prepaint scripts agree with the runtime resolver, including denied storage',()=>{
  for(const file of ['index.html','produto.html']){
    const html=readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
    const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
    for(const choice of [null,'auto','full','reduced','bad'])for(const os of [true,false])for(const denied of [false,true]){
      const context={document:{documentElement:{dataset:{}}},localStorage:{getItem(){if(denied)throw Error('denied');return choice;}},matchMedia:()=>({matches:os})};
      runInNewContext(script,context,{timeout:1000});
      assert.equal(context.document.documentElement.dataset.motionEffective,effectiveMotion(denied?'auto':choice,os));
    }
  }
});
test('004: actual shared Full exit stays open/locked until finite completion; reopening cancels obsolete finish',async()=>{
  const source=readFileSync(new URL('../src/ui/dialogs.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/m,'').replace(/\bexport /g,'');
  const animations=new Map(),queued=[],subscribers=[],document={body:{style:{overflow:''}},activeElement:null};
  const toggle={isConnected:true,attrs:{},setAttribute(k,v){this.attrs[k]=v;},focus(){document.activeElement=this;}};
  const close={focus(){document.activeElement=this;},isConnected:true};
  const dialog={id:'menu-dialog',open:false,dataset:{},showModal(){this.open=true;},close(){this.open=false;queued.push(()=>this.onclose?.());},querySelector(){return close;}};
  document.querySelector=s=>s==='dialog[open]'?(dialog.open?dialog:null):toggle;
  document.querySelectorAll=()=>[];
  function cancelMotion(d){animations.get(d)?.cancel();animations.delete(d);}
  function panelMotion(d){
    let resolve,reject;
    const finished=new Promise((a,b)=>{resolve=a;reject=b;});
    const a={finished,finish:resolve,cancel:()=>reject(Error('canceled'))};
    animations.set(d,a);return a;
  }
  const context={document,panelMotion,cancelMotion,onMotionChange:fn=>subscribers.push(fn),getComputedStyle:()=>({transform:'none'}),setTimeout,clearTimeout};
  runInNewContext(`${source};globalThis.api={openDialog,closeDialog};`,context);
  context.api.openDialog(dialog,toggle);
  animations.get(dialog).finish();await Promise.resolve();
  const first=context.api.closeDialog(dialog);
  assert.equal(dialog.open,true);assert.equal(dialog.dataset.dialogPhase,'closing');assert.equal(document.body.style.overflow,'hidden');assert.equal(toggle.attrs['aria-expanded'],'true');
  context.api.openDialog(dialog,toggle); // cancel exit, no native close and no focus outside
  assert.equal(await first,false);
  assert.equal(dialog.open,true);assert.equal(toggle.attrs['aria-expanded'],'true');
  animations.get(dialog).finish();await Promise.resolve();
  const final=context.api.closeDialog(dialog);
  animations.get(dialog).finish();
  assert.equal(await final,true);assert.equal(dialog.open,false);assert.equal(toggle.attrs['aria-expanded'],'false');assert.equal(document.body.style.overflow,'');assert.equal(document.activeElement,toggle);
});
