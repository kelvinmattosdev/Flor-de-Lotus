import {announce,initShopNavigation} from './ui/storefront.js';
import {getCategories,getProducts} from './shop/catalog.js';
import {errorMessage} from './shop/api.js';
import {$,escape,wireImages} from './ui/render.js';
import {motion,enterPage} from './ui/motion.js';
import {productCard} from './ui/product-card.js';

let categories=[],products=[],activeFilter='all',page=0,perPage=getPerPage(),loading=false,initialized=false,loadPromise=null,restoreIntent=0;
// Claim the prepaint handoff before any asynchronous catalogue work. The original
// navigation controller starts against the real layout, not a disappearing grid.
if(document.documentElement.dataset.sectionEntry)document.documentElement.dataset.sectionEntryClaimed='true';
function getPerPage(){return matchMedia('(max-width:680px)').matches?1:matchMedia('(max-width:900px)').matches?2:3;}
function filteredProducts(){
  const category=categories.find(c=>c.slug===activeFilter);
  if(!category)return products;
  const ids=new Set([category.id]);let changed=true;
  while(changed){changed=false;for(const c of categories)if(ids.has(c.parentId)&&!ids.has(c.id)){ids.add(c.id);changed=true;}}
  return products.filter(p=>ids.has(p.categoryId));
}
function renderProducts(){
  const list=filteredProducts();page=Math.min(page,Math.max(0,Math.ceil(list.length/perPage)-1));const first=page*perPage;
  $('#product-grid').innerHTML=list.length?list.slice(first,first+perPage).map(productCard).join(''):'<p class="empty-state">Nenhum anúncio publicado nesta seleção.</p>';
  $('#previous-products').disabled=loading||page===0;$('#next-products').disabled=loading||first+perPage>=list.length;
  $('#carousel-position').textContent=list.length?`${first+1}—${Math.min(first+perPage,list.length)} / ${list.length}`:'0 / 0';
  $('#collection-count').textContent=`${list.length} ${list.length===1?'peça':'peças'}`;
  document.querySelectorAll('[data-filter]').forEach(b=>{const active=b.dataset.filter===activeFilter;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  wireImages();
}
function savePosition(){history.replaceState({...history.state,collection:{filter:activeFilter,page,scroll:scrollY,focus:document.activeElement?.getAttribute('data-product')||''}},'');}
function saveURL(){const url=new URL(location.href);url.searchParams.set('filtro',activeFilter);url.searchParams.set('pagina',String(page+1));history.replaceState({...history.state,collection:{filter:activeFilter,page,scroll:scrollY,focus:''}},'',url);}
function restore(){
  const params=new URLSearchParams(location.search),state=history.state?.collection,filter=state?.filter||params.get('filtro');
  activeFilter=categories.some(c=>c.slug===filter)?filter:'all';const n=Number(params.get('pagina'));
  page=Number.isInteger(state?.page)&&state.page>=0?state.page:Number.isSafeInteger(n)&&n>0?n-1:0;
  renderProducts();
}
function load(){if(!loadPromise)loadPromise=fetchCatalog().finally(()=>{loadPromise=null;});return loadPromise;}
async function fetchCatalog(){
  loading=true;$('#product-grid').setAttribute('aria-busy','true');$('#catalog-status').textContent='Consultando anúncios e categorias…';
  try{
    const [cats,rows]=await Promise.all([getCategories(),getProducts()]);
    categories=cats;products=rows;
    $('.filters').innerHTML='<button class="filter" data-filter="all" aria-pressed="false">Todas</button>'+categories.map(c=>`<button class="filter" data-filter="${escape(c.slug)}" aria-pressed="false">${escape(c.path)}</button>`).join('');
    loading=false;restore();$('#catalog-status').textContent='Catálogo atualizado pela loja. Valores e compras demonstrativos.';
  }catch(error){$('#catalog-status').textContent=errorMessage(error)+' Nenhum catálogo local foi usado como substituto.';}
  finally{
    loading=false;$('#product-grid').setAttribute('aria-busy','false');
    if(!initialized){initialized=true;initShopNavigation();enterPage();document.documentElement.dataset.ready='true';}
  }
}
$('.filters').addEventListener('click',event=>{const b=event.target.closest('[data-filter]');if(!b||loading)return;activeFilter=b.dataset.filter;page=0;renderProducts();saveURL();motion($('#product-grid'),[{opacity:.5,transform:'translateX(7px)'},{opacity:1,transform:'none'}],180);announce(`Coleção: ${b.textContent}.`);});
document.querySelectorAll('[data-collection-filter]').forEach(link=>link.addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;activeFilter=link.dataset.collectionFilter;page=0;if(products.length){renderProducts();saveURL();}}));
function moveProducts(direction){page+=direction;renderProducts();saveURL();motion($('#product-grid'),[{opacity:.5,transform:`translateX(${direction*10}px)`},{opacity:1,transform:'none'}],180);const b=direction>0?$('#next-products'):$('#previous-products');if(b.disabled)(direction>0?$('#previous-products'):$('#next-products')).focus({preventScroll:true});}
$('#previous-products').addEventListener('click',()=>moveProducts(-1));$('#next-products').addEventListener('click',()=>moveProducts(1));
$('#catalog-retry').addEventListener('click',load);
window.addEventListener('resize',()=>{const next=getPerPage();if(next!==perPage){const first=page*perPage;perPage=next;page=Math.floor(first/perPage);if(products.length){renderProducts();saveURL();}}});
document.addEventListener('click',event=>{if(event.target.closest('a[data-product]'))savePosition();});
window.addEventListener('pagehide',savePosition);window.addEventListener('popstate',restore);
for(const type of ['wheel','touchstart','pointerdown','keydown'])window.addEventListener(type,()=>{restoreIntent++;},{passive:true});
window.addEventListener('pageshow',event=>{const state=history.state?.collection,back=performance.getEntriesByType('navigation')[0]?.type==='back_forward',request=restoreIntent;if(!event.persisted&&back&&state)load().then(()=>{if(request!==restoreIntent)return;restore();requestAnimationFrame(()=>{if(request!==restoreIntent)return;scrollTo({top:state.scroll||0,behavior:'instant'});if(state.focus)document.querySelector(`#product-grid a[data-product="${CSS.escape(state.focus)}"]`)?.focus({preventScroll:true});});});});
load();
