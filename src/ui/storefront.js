import {money} from '../data/catalog.js';
import {findProduct,getProduct,getProductsByIDs} from '../shop/catalog.js';
import {addItem, setQuantity, removeItem, loadCart, saveCart, itemCount, reconcile, fingerprint, MAX_QUANTITY, STORAGE_KEY} from '../shop/cart.js';
import {api,errorMessage} from '../shop/api.js';
import {createCheckoutView,couponForm,handleCoupons} from '../shop/checkout-view.js';
import {openDialog, closeDialog, initDialogs} from './dialogs.js';
import {$, icon, closeButton, escape, imageTag, wireImages} from './render.js';
import {mountShell} from './shell.js';
import {motion, numberChange} from './motion.js';
import {initSectionNavigation} from './section-navigation.js';

mountShell();
initDialogs();
let navigationStarted=false;
export function initShopNavigation(){if(!navigationStarted){navigationStarted=true;initSectionNavigation();}}
let storage;
try { storage = window.localStorage; } catch { /* denied storage is non-fatal */ }
let cart = loadCart(storage);
let storageAvailable = Boolean(storage);
let toastTimer;
let toastExitTimer;
const cartDialog = $('#cart-dialog');
const checkoutDialog = $('#checkout-dialog');
const infoDialog = $('#info-dialog');
const menuDialog = $('#menu-dialog');

export function announce(text) {
  $('#announcer').textContent = '';
  requestAnimationFrame(() => { $('#announcer').textContent = text; });
}
function toast(text) {
  const dialog=document.querySelector('dialog[open]');
  let element=$('#toast');
  if(dialog) {
    element=dialog.querySelector('[data-dialog-feedback]');
    if(!element) {
      element=document.createElement('p');
      element.className='dialog-feedback';element.dataset.dialogFeedback='true';
      element.setAttribute('role','status');element.setAttribute('aria-live','polite');
      (dialog.querySelector('.dialog-header>div')||dialog.querySelector('.dialog-header')).append(element);
    }
  }
  clearTimeout(toastTimer);
  clearTimeout(toastExitTimer);
  element.textContent = text;
  element.hidden = false;
  const transform=dialog?'translateY(12px)':'translate(-50%,12px)',end=dialog?'none':'translate(-50%,0)';
  motion(element,[{opacity:.75,transform},{opacity:1,transform:end}],320);
  toastTimer=setTimeout(()=>{
    const animation=motion(element,[{opacity:1,transform:end},{opacity:0,transform}],220);
    if(animation) {
      const hide=()=>{element.hidden=true;};
      animation.finished.then(hide).catch(()=>{});
      toastExitTimer=setTimeout(hide,300);
    }else element.hidden=true;
  },3800);
}
function updateCart(persist = true) {
  if(persist)storageAvailable = saveCart(storage, cart);
  document.querySelectorAll('[data-cart-count]').forEach(node => {
    const count = String(itemCount(cart));
    if(node.textContent !== count) { node.textContent = count; numberChange(node); }
  });
  document.querySelectorAll('[data-open-cart]').forEach(node => node.setAttribute('aria-label', `Abrir sacola, ${itemCount(cart)} ${itemCount(cart) === 1 ? 'item' : 'itens'}`));
}
export async function addProduct(product, quantity, buyNow, origin, variant='') {
  const current=await getProduct(product.id);
  if(!current)throw new Error('Este anúncio não está mais disponível. Sua sacola foi mantida.');
  // Refresh from the shared schema before adding: another tab may have changed the basket.
  if(storageAvailable) cart = loadCart(storage);
  cart = addItem(cart, current, variant, quantity);
  updateCart();
  if(buyNow) { renderCheckout(); openDialog(checkoutDialog, origin); }
  else { renderCart(); openDialog(cartDialog, origin); }
  toast(`${quantity} × ${product.name} na sacola de demonstração.`);
}
let cartRequest=0,cartValidated=false,cartNotice='';
async function validateCart(){
  const before=fingerprint(cart),rows=await getProductsByIDs(cart.map(i=>i.id));
  if(storageAvailable)cart=loadCart(storage);
  if(fingerprint(cart)!==before)throw new Error('A sacola mudou em outra aba. Revise-a novamente.');
  const result=reconcile(cart,rows);
  if(result.removed.length){cart=result.items;updateCart();cartNotice=`${result.removed.length} item(ns) removido(s): anúncio indisponível ou opção alterada pela loja. Os demais foram mantidos.`;}
  cartValidated=true;return cart;
}
const checkoutView=createCheckoutView({storage,getCart:()=>cart,readCart:()=>storageAvailable?loadCart(storage):cart,setCart:next=>{cart=next;},updateCart,validateCart,announce,focusReceipt:()=>{
  checkoutDialog.scrollTop = 0;
  $('#checkout-title').focus({ preventScroll: true });
}});
const subtotal=items=>items.reduce((n,i)=>n+(findProduct(i.id)?.price||0)*i.quantity,0);
function renderCart(focusKey,fetchOfficial=true) {
  const request=++cartRequest;if(fetchOfficial)cartValidated=false;
  $('#cart-heading-count').textContent = `(${itemCount(cart)})`;
  $('#cart-items').innerHTML = cart.length ? cart.map(item => {
    const product = findProduct(item.id), key = `${item.id}-${item.variant}`;
    if(!product)return `<article class="cart-item" data-id="${escape(item.id)}" data-variant="${escape(item.variant)}"><h3>${escape(item.id)}</h3><p>${item.quantity} unidade(s). Aguardando validação do anúncio na loja; o item continua na sacola.</p><button data-remove>Remover</button></article>`;
    return `<article class="cart-item" data-id="${item.id}" data-variant="${escape(item.variant)}">
      ${imageTag(product.gallery[0], 'cart-item-image', 88)}
      <div class="cart-item-copy">
        <div class="cart-item-top"><h3>${escape(product.name)}</h3><span class="cart-item-price">${money(product.price * item.quantity)}</span></div>
        <p class="cart-item-meta">${product.family === 'sebo' ? 'Sebo · livro' : 'Artesanato'}${item.variant ? ` · ${escape(item.variant)}` : ''}<br>Pronta entrega · demonstração</p>
        <div class="quantity-row"><div class="quantity-control" role="group" aria-label="Quantidade de ${escape(product.name)}">
          <button data-quantity="minus" data-focus="${escape(key)}-minus" aria-label="Diminuir quantidade de ${escape(product.name)}" ${item.quantity <= 1 ? 'disabled' : ''}>−</button>
          <output aria-label="Quantidade">${item.quantity}</output>
          <button data-quantity="plus" data-focus="${escape(key)}-plus" aria-label="Aumentar quantidade de ${escape(product.name)}" ${item.quantity >= MAX_QUANTITY ? 'disabled' : ''}>+</button>
        </div><button class="remove-button" data-remove aria-label="Remover ${escape(product.name)}">Remover</button></div>
      </div></article>`;
  }).join('') : `<div class="empty-state">${icon('bag')}<h3>Sua sacola está em branco.</h3><p>Que tal começar por uma peça da coleção?</p><button class="btn btn--primary" data-return-collection>Ver coleção ${icon('arrow')}</button></div>`;
  $('#cart-bottom').innerHTML = cart.length ? `
    <div class="summary-line"><span>Subtotal estimado dos anúncios consultados</span><strong>${money(subtotal(cart))}</strong></div>
    <p class="checkout-note">O servidor confirma preços e cupons na próxima etapa.</p>${couponForm()}
    <p id="cart-validation" role="status">${escape(cartNotice)} ${fetchOfficial?'Validando anúncios atuais…':''}</p><button class="text-button" data-retry-cart>Validar sacola novamente</button>
    <button class="btn btn--primary" id="begin-checkout" ${cartValidated?'':'disabled'}>Continuar simulação ${icon('arrow')}</button>
    <p class="small-note">Nenhuma compra real. Sem cobrança ou coleta de dados pessoais.</p>
    ${storageAvailable ? '' : '<p class="small-note">Armazenamento indisponível. A sacola ficará somente nesta visita.</p>'}` : `<p class="small-note">Compras fictícias registradas apenas após confirmação pela loja.</p>`;
  if (focusKey) {
    const button = cartDialog.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
    if (button && !button.disabled) button.focus({ preventScroll: true });
    else button?.parentElement.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    numberChange(button?.parentElement.querySelector('output'));
  }
  wireImages();
  if(fetchOfficial&&cart.length)validateCart().then(()=>{
    if(request!==cartRequest)return;
    const input=cartDialog.querySelector('[name="coupon"]'),value=input?.value,typing=input&&document.activeElement===input;
    renderCart(document.activeElement?.dataset.focus===focusKey?focusKey:undefined,false);
    const replacement=cartDialog.querySelector('[name="coupon"]');
    if(replacement&&value!==undefined){replacement.value=value;if(typing)replacement.focus({preventScroll:true});}
  }).catch(error=>{if(request===cartRequest&&$('#cart-validation'))$('#cart-validation').textContent=errorMessage(error);});
}
function renderCheckout() { checkoutView.show(); }

function showInfo(title, content, eyebrow = 'Flor de Lotus', origin) {
  $('#info-content').innerHTML = `<button class="icon-button close-info" data-close aria-label="Fechar informações">${icon('close')}</button>
    <svg class="info-flower" viewBox="0 0 48 48" aria-hidden="true"><use href="#lotus-symbol"/></svg>
    <p class="eyebrow">${eyebrow}</p><h2 id="info-title" tabindex="-1" data-initial-focus>${title}</h2>${content}`;
  openDialog(infoDialog, origin);
}
function showCustom(origin) {
  showInfo('Uma peça,<br><em>do seu jeito.</em>', `
    <p>Uma encomenda artesanal pode começar com uma ideia de pingente, cores ou miçangas. Os chaveiros Bubu e Pipo apresentam essa possibilidade.</p>
    <p><strong>Esta é apenas uma demonstração.</strong> Não informe dados pessoais. Não há orçamento, contratação ou envio de mensagens.</p>
    <div class="contact-option"><span>WhatsApp</span><span>Canal não configurado</span></div>
    <div class="contact-option"><span>Instagram</span><span>Canal não configurado</span></div>
    <p class="checkout-note">Os contatos oficiais serão definidos pela Flor de Lotus. Peças sob encomenda não são adicionadas à sacola como produtos de preço fechado.</p>
    <button class="btn btn--primary" data-close>Continuar visita ${icon('arrow')}</button>`, 'Artesanato sob encomenda', origin);
}
document.addEventListener('click', event => {
  const customButton = event.target.closest('[data-custom]');
  if (customButton) showCustom(customButton);
  const cartButton = event.target.closest('[data-open-cart]');
  if (cartButton) { if(storageAvailable)cart=loadCart(storage); renderCart(); openDialog(cartDialog, cartButton); }
  if(event.target.closest('[data-retry-cart]'))renderCart();
  if(event.target.closest('#back-to-cart')){renderCart();openDialog(cartDialog);}
  if (event.target.closest('#begin-checkout')) {
    if (!cart.length) return;
    renderCheckout(); openDialog(checkoutDialog);
  }
  const item = event.target.closest('.cart-item');
  const quantityButton = event.target.closest('[data-quantity]');
  if (item && quantityButton) {
    if(storageAvailable)cart=loadCart(storage);
    const current = cart.find(line => line.id === item.dataset.id && line.variant === item.dataset.variant);
    if (!current) return;
    const next = current.quantity + (quantityButton.dataset.quantity === 'plus' ? 1 : -1);
    cart = setQuantity(cart, current.id, current.variant, next);
    updateCart(); checkoutView.invalidate(); renderCart(quantityButton.dataset.focus);
    toast(`Quantidades atualizadas. ${itemCount(cart)} itens na sacola.`);
    announce(`Quantidade atualizada. ${itemCount(cart)} itens na sacola. Subtotal ${money(subtotal(cart))}.`);
  }
  if (item && event.target.closest('[data-remove]')) {
    if(storageAvailable)cart=loadCart(storage);
    const name = findProduct(item.dataset.id)?.name||item.dataset.id;
    cart = removeItem(cart, item.dataset.id, item.dataset.variant);
    updateCart(); checkoutView.invalidate(); renderCart();
    (cartDialog.querySelector('[data-remove]') || cartDialog.querySelector('[data-return-collection]') || cartDialog.querySelector('[data-close]')).focus({ preventScroll: true });
    announce(`${name} removido. ${itemCount(cart)} itens na sacola.`);
  }
  if (event.target.closest('[data-return-collection]')) {
    closeDialog(document.querySelector('dialog[open]'), false).then(closed=>{
      if(!closed)return;
      if(!$('#colecao')) { location.assign('/index.html#colecao'); return; }
      $('#colecao').scrollIntoView({ behavior: 'instant' });
      $('#collection-title').tabIndex = -1;
      $('#collection-title').focus({ preventScroll: true });
    });
  }
});
$('#menu-toggle').addEventListener('click', event => {
  event.currentTarget.setAttribute('aria-expanded', 'true');
  openDialog(menuDialog, event.currentTarget);
});
$('#about-demo').addEventListener('click', event => showInfo('Uma loja para<br><em>experimentar.</em>', `
  <p>Este protótipo apresenta artesanato e sebo da Flor de Lotus com imagens fornecidas para teste local. Preços, avaliações, disponibilidade, pagamentos e entregas são fictícios, não ofertas reais.</p>
   <p>A sacola guarda apenas identificadores, opções e quantidades neste navegador. Contas de teste e pedidos fictícios ficam no arquivo privado da loja. Não use dados nem senhas reais. O CEP fica apenas no formulário, sem persistência ou consulta externa.</p>
   <p>O checkout registra compras demonstrativas na API local; não se conecta a bancos, transportadoras ou serviços de email.</p>
  <button class="btn btn--primary" data-close>Continuar visita ${icon('arrow')}</button>`, 'Sobre esta demonstração', event.currentTarget));
$('#credits-button').addEventListener('click', event => showInfo('Imagens da marca<br><em>e dos produtos.</em>', `
  <p>As três artes da marca e as fotografias de produtos foram fornecidas pelo usuário para teste local. Autoria, licenças e direitos de publicação não foram verificados. Não são fotografias Pexels.</p>
  <p>As capturas foram recortadas em cópias para excluir a interface e dados de terceiros. As bolsas mantêm os limites do enquadramento original; não foram reconstruídas. Detalhes aproximados são recortes da mesma foto, não novos ângulos. Capas de livros e nomes de obras pertencem aos respectivos titulares.</p>
  <p>Os pequenos traços de morangos, miçangas e correntes nas laterais são desenhos originais desta interface, sem reprodução do logo ou de personagens de Nana.</p>
  <p class="small-note">Tipografia local: Cormorant Garamond e DM Sans, SIL Open Font License 1.1. As fontes e suas licenças acompanham o protótipo.</p>`, 'Créditos da demonstração', event.currentTarget));
window.addEventListener('storage', event => {
  // null is a genuine localStorage.clear from another tab. No app-wide clear is issued here.
  if(event.storageArea !== storage || (event.key !== STORAGE_KEY && event.key !== null))return;
  cart=loadCart(storage);
  updateCart(false);
  if(cartDialog.open)renderCart();
  // A completed recap is immutable; new basket activity belongs to the next purchase.
  if(checkoutDialog.open && !checkoutDialog.querySelector('.success-view')) {
    const focusedId=document.activeElement?.id;
    checkoutView.invalidate();
    if(checkoutDialog.open)(document.getElementById(focusedId)||$('#checkout-title'))?.focus({preventScroll:true});
  }
});
handleCoupons(cartDialog,()=>{checkoutView.invalidate();renderCart();},()=>checkoutView.isLocked());
api.getSession().then(s=>{document.querySelectorAll('[data-account-label]').forEach(n=>{n.textContent=s.user?.role==='CUSTOMER'?'Minha conta':'Entrar';});}).catch(()=>{});
window.addEventListener('pageshow', () => {
  if(storageAvailable)cart=loadCart(storage);updateCart(false);
  if(new URLSearchParams(location.search).get('checkout')==='1'&&cart.length){renderCheckout();openDialog(checkoutDialog);}
});
updateCart(false);
wireImages();
