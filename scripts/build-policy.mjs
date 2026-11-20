import assets from './static-assets.json' with {type: 'json'};

export const STATIC_ASSETS = Object.freeze(assets);
export const PAGES = Object.freeze(['index.html', 'produto.html', 'conta.html', 'operador.html']);
export const BUNDLE = /^assets\/[A-Za-z0-9_-]{1,100}-[A-Za-z0-9_-]{8,32}\.(?:js|css)$/;
export const FRONTEND_FILES = Object.freeze([
  'src/main.js', 'src/product.js', 'src/styles.css', 'src/motion.css',
  'src/data/catalog.js', 'src/domain/cart.js', 'src/domain/motion-preference.js',
  'src/domain/offer.js', 'src/domain/shipping.js',
  'src/ui/dialogs.js', 'src/ui/gallery.js', 'src/ui/motion.js',
  'src/ui/motion-preference.js', 'src/ui/product-card.js', 'src/ui/render.js',
  'src/ui/section-navigation.js', 'src/ui/shell.js', 'src/ui/storefront.js',
  // Modulos de UI identificados por nomes durante a janela paralela.
  // Novos arquivos exigem revisao desta lista e de .dockerignore apos freeze.
  'src/shop/api.js', 'src/shop/schema.js', 'src/shop/cart.js',
  'src/shop/catalog.js', 'src/shop/checkout.js', 'src/shop/checkout-view.js',
  'src/shop/account.js',
  'src/operador/main.js', 'src/operador/operador.css', 'src/operador/ui.js',
  'src/operador/api.js', 'src/operador/catalog.js', 'src/operador/domain.js',
  'src/operador/editor.js', 'src/operador/coupons.js', 'src/operador/commerce.js'
]);
export const isStaticFile = name => PAGES.includes(name) || BUNDLE.test(name) || STATIC_ASSETS.includes(name);
