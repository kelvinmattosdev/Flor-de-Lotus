import {motion, cancelMotion, onMotionChange} from './motion.js';
import {imageTag, wireImages} from './render.js';
// The current decoded frame stays opaque until its successor is decoded and painted.
export function initGallery({container,images,buttons,note,describe,announce,status}) {
  let generation=0,current=0,disposed=false,transition;
  const first=document.createElement('div');
  first.className='gallery-slot';
  first.append(...container.childNodes);container.append(first);
  function commit() {
    clearTimeout(transition?.timer);
    if(transition){cancelMotion(transition.next);transition.old.remove();transition=undefined;}
  }
  onMotionChange(reduced=>{if(reduced)commit();});
  buttons.forEach(button=>button.addEventListener('click',async()=>{
    const index=Number(button.dataset.galleryIndex);
    const token=++generation;
    commit();
    if(index===current){container.setAttribute('aria-busy','false');status.textContent='';return;}
    container.setAttribute('aria-busy','true');
    status.textContent='Preparando fotografia. A imagem atual continua visível.';
    const next=document.createElement('div');
    next.className='gallery-slot';
    next.innerHTML=imageTag(images[index],'',475,false,true);
    const image=next.querySelector('img');
    try {
      if(typeof image.decode==='function')await image.decode();
      else await new Promise((resolve,reject)=>{if(image.complete&&image.naturalWidth)resolve();else{image.onload=resolve;image.onerror=reject;}});
      if(!image.naturalWidth)throw Error('Image unavailable');
      if(disposed||token!==generation)return;
      const old=container.querySelector('.gallery-slot');
      container.append(next);
      current=index;
      buttons.forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      note.textContent=describe(images[index]);
      status.textContent='';container.setAttribute('aria-busy','false');
      const animation=motion(next,[{opacity:0},{opacity:1}],320);
      if(animation) {
        const entry={old,next,timer:undefined};transition=entry;
        const finish=()=>{if(transition===entry)commit();};
        animation.finished.then(finish).catch(()=>{});
        entry.timer=setTimeout(finish,400);
      }else old.remove();
      wireImages(next);
      announce(`Fotografia: ${images[index].label}. ${describe(images[index])}`);
    }catch {
      if(disposed||token!==generation)return;
      container.setAttribute('aria-busy','false');
      status.textContent='Não foi possível abrir esta fotografia. A imagem anterior foi mantida.';
      announce(status.textContent);
    }
  }));
  window.addEventListener('pagehide',()=>{disposed=true;generation++;commit();});
  window.addEventListener('pageshow',()=>{disposed=false;});
}
