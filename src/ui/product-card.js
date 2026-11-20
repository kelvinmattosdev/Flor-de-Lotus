import {money} from '../data/catalog.js';
import {discountPercent} from '../domain/offer.js';
import {escape, imageTag, productURL, icon} from './render.js';
export function productCard(product) {
  return `<article class="product-card card" aria-label="${escape(product.name)}, exemplo demonstrativo">
    <p class="product-kicker">${product.family==='sebo'?'Sebo · livro':'Artesanato'}<span>${product.mode==='custom'?'Encomenda · demo':'Pronta entrega · demo'}</span></p>
    <a class="product-media m-zoom" href="${productURL(product.id)}" data-product="${product.id}" aria-label="Ver ${escape(product.name)}">${imageTag(product.gallery[0])}</a>
    <div class="product-info"><div class="product-title-row"><h3><a href="${productURL(product.id)}" data-product="${product.id}">${escape(product.name)}</a></h3>
    ${product.mode==='custom'?'<p class="product-price">Sob encomenda · sem preço fechado</p>':`<p class="card-offer">${product.compareAtPrice?`<span>De <s>${money(product.compareAtPrice)}</s></span>`:''}<strong>Por ${money(product.price)}</strong>${product.compareAtPrice?`<span>${discountPercent(product.price,product.compareAtPrice)}% de desconto fictício</span>`:''}</p><p class="small-note">Valores fictícios de demonstração</p>`}</div>
    <p class="product-detail">${escape(product.detail)}</p>
    <a class="product-view-link m-link" href="${productURL(product.id)}" data-product="${product.id}">Ver peça ${icon('arrow')}</a></div></article>`;
}
