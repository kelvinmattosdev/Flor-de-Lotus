import './ui/storefront.js';
import {money} from './data/catalog.js';
import {discountPercent, ratingSummary, selectedQuantity} from './domain/offer.js';
import {getProduct,getProducts} from './shop/catalog.js';
import {isID} from './shop/schema.js';
import {errorMessage} from './shop/api.js';
import {formatCEP, validCEP, createQuoteTask} from './domain/shipping.js';
import {$, escape, imageTag, icon, wireImages} from './ui/render.js';
import {productCard} from './ui/product-card.js';
import {addProduct, announce,initShopNavigation} from './ui/storefront.js';
import {enterPage, motion, numberChange, reveal} from './ui/motion.js';
import {initGallery} from './ui/gallery.js';

let product=null,related=[],relatedError=false,loading=false;
const relatedProducts=()=>related;
function productFromSearch(search){
  const params=new URLSearchParams(search),ids=params.getAll('id');
  return ids.length===1&&isID(ids[0])?ids[0]:null;
}
const setMeta = (selector,content) => document.querySelector(selector)?.setAttribute('content',content);
function render() {
  if(!product) {
    document.title='Produto não encontrado · Flor de Lotus';
    setMeta('meta[name="description"]','Produto não encontrado. Volte à coleção da Flor de Lotus.');
    setMeta('meta[property="og:title"]',document.title);
    $('#product-page').innerHTML=`<section class="not-found wrap" data-page-enter><p class="eyebrow">Flor de Lotus</p><h1 id="product-title" tabindex="-1">Produto não encontrado.</h1><p>Este link não identifica uma referência da coleção.</p><a class="btn btn--primary" href="/index.html#colecao">Voltar à coleção ${icon('arrow')}</a></section>`;
    return;
  }
  document.title=`${product.name} · Flor de Lotus`;
  setMeta('meta[name="description"]',product.description);
  setMeta('meta[property="og:title"]',document.title);
  setMeta('meta[property="og:description"]',product.description);
  setMeta('meta[property="og:image"]',product.gallery[0].src);
  const rating=ratingSummary(product.reviews), ready=product.mode==='ready';
  $('#product-page').innerHTML=`
    <section class="pdp-hero wrap" aria-labelledby="product-title" data-page-enter>
      <a class="pdp-back text-button" href="/index.html#colecao">${icon('back')} Voltar à coleção</a>
      <div class="pdp-heading"><div><p class="eyebrow">Flor de Lotus · referência para conhecer</p><h1 id="product-title" tabindex="-1">${escape(product.name)}</h1></div>${rating.count?`<a class="rating-link" href="#avaliacoes"><strong>${String(rating.average).replace('.',',')} / 5</strong><span>${rating.count} avaliações fictícias</span></a>`:'<p class="small-note">Ainda sem avaliações.</p>'}</div>
      <div class="pdp-layout">
        <div class="pdp-gallery">
          ${product.gallery.length>1?`<div class="pdp-thumbnails" role="group" aria-label="Fotografias de ${escape(product.name)}">${product.gallery.map((image,index)=>`<button class="pdp-thumb" type="button" data-gallery-index="${index}" aria-pressed="${index===0}" aria-controls="pdp-image" aria-label="Mostrar ${escape(image.label.toLowerCase())}"><img src="${escape(image.thumb)}" width="${image.width}" height="${image.height}" alt="" loading="lazy"><span>${escape(image.label)}</span></button>`).join('')}</div>`:''}
          <div class="pdp-photo" id="pdp-image">${imageTag(product.gallery[0],'',475,false,true)}</div>
          <p class="gallery-note" id="gallery-note">${galleryNote(product.gallery[0])}</p>
          <p class="gallery-status" id="gallery-status" role="status" aria-live="polite"></p>
        </div>
        <div class="pdp-summary">
          <p class="pdp-detail">${escape(product.detail)}</p>
          ${ready?`<div class="pdp-offer">${product.compareAtPrice?`<p class="price-before">De <s>${money(product.compareAtPrice)}</s></p>`:''}<div class="price-line"><p><span>Por</span> <strong>${money(product.price)}</strong></p>${product.compareAtPrice?`<span class="discount">${discountPercent(product.price,product.compareAtPrice)}% de desconto fictício</span>`:''}</div><p class="demo-price-label">Valores fictícios de demonstração</p></div>
          <p class="availability">Pronta entrega · disponibilidade demonstrativa</p>
          <form id="product-purchase" novalidate>
            ${product.variants.length?`<label for="product-variant">Opção da peça</label><select id="product-variant">${product.variants.map(v=>`<option value="${escape(v)}">${escape(v)}</option>`).join('')}</select>`:''}
            <label class="quantity-label" for="product-quantity">Quantidade <span>1 a 9 por item na sacola</span></label>
            <div class="pdp-quantity"><button type="button" data-step="-1" aria-label="Diminuir quantidade">−</button><input id="product-quantity" name="quantity" type="number" inputmode="numeric" min="1" max="9" step="1" value="1" aria-describedby="purchase-error"><button type="button" data-step="1" aria-label="Aumentar quantidade">+</button></div>
            <p class="detail-error" id="purchase-error" role="status"></p>
            <div class="purchase-actions"><button class="btn btn--primary" type="submit" name="action" value="buy">Comprar · simulação ${icon('arrow')}</button><button class="btn btn--secondary" type="submit" name="action" value="add">Adicionar à sacola ${icon('bag')}</button></div>
            <p class="purchase-note">Comprar adiciona esta quantidade à sacola existente. O checkout inclui também os outros itens; nada é substituído.</p>
          </form>
          ${shippingForm()}`:`<div class="custom-offer"><h2>Sob encomenda.</h2><p>Peça de referência, sem preço fechado ou compra direta. Não há orçamento, contratação ou estoque garantido nesta demonstração.</p><button class="btn btn--primary" data-custom>Sobre a encomenda ${icon('arrow')}</button><p class="small-note">Canais de atendimento ainda não configurados.</p></div>`}
        </div>
      </div>
    </section>
    <section class="pdp-description" aria-labelledby="description-title"><div class="wrap pdp-description-grid"><div><p class="eyebrow">A peça de perto</p><h2 id="description-title">Sobre ${product.family==='sebo'?'o livro':'a peça'}.</h2></div><div><p>${escape(product.description)}</p><dl class="pdp-characteristics"><div><dt>Referência</dt><dd>${escape(product.detail)}</dd></div><div><dt>Fotografias disponíveis</dt><dd>${photoDescription()}</dd></div><div><dt>${product.family==='sebo'?'Conservação e edição':'Medidas e composição'}</dt><dd>Não confirmadas para uma oferta comercial.</dd></div><div><dt>Experiência</dt><dd>Somente demonstração local, sem venda real.</dd></div></dl></div></div></section>
    <section class="pdp-reviews wrap" id="avaliacoes" aria-labelledby="reviews-title"><div class="reviews-heading"><div><p class="eyebrow">Textos de demonstração</p><h2 id="reviews-title">Avaliações de exemplo.</h2><p>${rating.count?'Nenhum comentário vem de uma compra real.':'Este anúncio ainda não tem avaliações. Nenhuma avaliação foi inventada.'}</p></div>${rating.count?`<div class="rating-summary"><strong>${String(rating.average).replace('.',',')}<span>/5</span></strong><span>${rating.count} avaliações fictícias</span></div>`:''}</div><div class="reviews-list">${product.reviews.map(review=>`<article class="review"><p class="review-label">Avaliação fictícia · exemplo</p><div class="review-meta"><h3>${escape(review.author)}</h3><span aria-label="${review.rating} de 5 estrelas">${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)}</span></div><p>${escape(review.text)}</p></article>`).join('')}</div></section>
    <section class="pdp-related" aria-labelledby="related-title"><div class="wrap"><div class="section-heading"><div><p class="eyebrow">Na mesma loja</p><h2 id="related-title">Outras peças para conhecer.</h2></div><a class="text-button" href="/index.html#colecao">Ver coleção ${icon('arrow')}</a></div><div class="related-grid">${relatedProducts(product).map(productCard).join('')||`<p>${relatedError?'Não foi possível consultar anúncios relacionados.':'Nenhum outro anúncio publicado.'}</p>`}</div></div></section>`;
}
function galleryNote(image) {
  if(image.label==='Detalhe')return 'Detalhe da mesma fotografia. Não é outro ângulo.';
  if(image.label==='Em uso'&&product.id==='FDL-CRAFT-MORANGO')return 'Foto em uso: somente o brinco pendente de morango integra o par. Outros adornos não estão incluídos.';
  return product.gallery.length===1?'Uma fotografia disponível. Enquadramento original preservado, sem inventar outros ângulos.':'Fotografia fornecida para teste local. Use os controles para ver as imagens disponíveis.';
}
function photoDescription() {
  if(product.id==='FDL-CRAFT-MORANGO')return 'Peça e foto em uso; outros adornos não incluídos.';
  if(product.gallery.some(i=>i.label==='Detalhe'))return 'Foto principal e recorte de detalhe da mesma fotografia.';
  return product.gallery.length===1?'Uma fotografia de referência, sem vistas adicionais.':product.gallery.some(i=>i.label==='Verso')?'Frente e verso do mesmo exemplar de referência.':`${product.gallery.length} fotografias fornecidas para este anúncio.`;
}
function shippingForm() {
  return `<section class="pdp-shipping" aria-labelledby="shipping-title"><h2 id="shipping-title">Entrega de exemplo</h2><p id="cep-help">Use um CEP de exemplo, não informe dados reais. Validação só de formato, sem consulta de endereço.</p><form id="shipping-form" novalidate autocomplete="off"><label for="cep">CEP demonstrativo</label><div class="cep-row"><input id="cep" type="text" inputmode="numeric" maxlength="9" placeholder="00000-000" autocomplete="off" aria-describedby="cep-help cep-error"><button class="btn btn--secondary" type="submit" id="quote-button">Simular frete</button></div><p class="detail-error" id="cep-error" role="status"></p></form><div id="shipping-results" aria-live="polite" aria-busy="false"></div><p class="shipping-note">Os quatro preços e prazos são exemplos fixos, sem garantia. Esta estimativa não seleciona a entrega; escolha a transportadora no checkout, com os mesmos valores.</p></section>`;
}
async function load(){
  if(loading)return;loading=true;$('#product-retry').disabled=true;$('#product-load-status').textContent='Consultando anúncio atual…';
  try{
    const id=productFromSearch(location.search);product=id?await getProduct(id):null;
    related=[];relatedError=false;
    if(product)try{related=(await getProducts()).filter(p=>p.id!==product.id).sort((a,b)=>Number(b.family===product.family)-Number(a.family===product.family)).slice(0,3);}catch{relatedError=true;}
    render();wireProduct();$('#product-load-status').textContent=product?'Anúncio consultado na loja. Preço final sujeito à prévia.':'Anúncio não encontrado ou não publicado.';
  }catch(e){$('#product-load-status').textContent=errorMessage(e)+' Nenhum anúncio local foi usado como substituto.';}
  finally{loading=false;$('#product-retry').disabled=false;wireImages();enterPage();document.documentElement.dataset.ready='true';}
}
function wireProduct(){if(product) {
  initGallery({container:$('#pdp-image'),images:product.gallery,buttons:[...document.querySelectorAll('[data-gallery-index]')],note:$('#gallery-note'),describe:galleryNote,announce,status:$('#gallery-status')});
  document.querySelectorAll('[data-step]').forEach(button=>button.addEventListener('click',()=>{
    try {
      const next=selectedQuantity($('#product-quantity').value)+Number(button.dataset.step);
      selectedQuantity(next);
      $('#product-quantity').value=next;
      $('#purchase-error').textContent='';
      numberChange($('#product-quantity'));
    }catch(error){$('#purchase-error').textContent=error.message;}
  }));
  $('#product-quantity')?.addEventListener('input',()=>{$('#purchase-error').textContent='';});
  $('#product-purchase')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const buttons=[...event.currentTarget.querySelectorAll('[type="submit"]')];buttons.forEach(b=>b.disabled=true);
    try {
      const quantity=selectedQuantity($('#product-quantity').value);
      await addProduct(product,quantity,event.submitter?.value==='buy',event.submitter||$('#product-quantity'),$('#product-variant')?.value||'');
      $('#purchase-error').textContent='';
    }catch(error){$('#purchase-error').textContent=errorMessage(error);$('#product-quantity').focus({preventScroll:true});}
    finally{buttons.forEach(b=>b.disabled=false);}
  });
  if($('#shipping-form'))wireShipping();
}}
function wireShipping() {
  const task=createQuoteTask(), input=$('#cep'), results=$('#shipping-results'), button=$('#quote-button'), error=$('#cep-error');
  function invalidate() {
    task.cancel(); results.innerHTML=''; results.setAttribute('aria-busy','false');
    button.disabled=false; button.textContent='Simular frete';
  }
  input.addEventListener('input',()=>{
    input.value=formatCEP(input.value); invalidate(); error.textContent=''; input.removeAttribute('aria-invalid');
  });
  $('#shipping-form').addEventListener('submit',event=>{
    event.preventDefault(); invalidate();
    if(!validCEP(input.value)) {
      error.textContent='Digite os 8 dígitos de um CEP de exemplo.';
      input.setAttribute('aria-invalid','true'); input.focus(); return;
    }
    error.textContent=''; input.removeAttribute('aria-invalid');
    button.disabled=true; button.textContent='Simulando…'; results.setAttribute('aria-busy','true');
    results.innerHTML='<p class="shipping-loading">Preparando exemplos locais…</p>';
    task.run(input.value,quotes=>{
      results.innerHTML=`<ul class="shipping-quotes">${quotes.map(q=>`<li><span><strong>${q.name}</strong><small>${q.days} · exemplo</small></span><strong>${money(q.price)}</strong></li>`).join('')}</ul>`;
      results.setAttribute('aria-busy','false'); button.disabled=false; button.textContent='Simular frete'; reveal(results);
    });
  });
  window.addEventListener('pagehide',()=>{invalidate();input.value='';});
}
initShopNavigation();
$('#product-retry').addEventListener('click',load);
load();
