import {ApiError, resource} from './api.js';
import {categoryGraph, decimal, diff, galleryFields, listingStates, maxPhotoBytes,
  money, productLimit, safePhoto, unitsFromDecimal} from './domain.js';
import {checked, editor, fieldHints, limits, read, snapshot, versionBadge} from './editor.js';
import {badge, band, button, check, empty, field, h, heading, input, loadView, pager,
  select, submit, text, textarea} from './ui.js';

const cats = resource('categorias');
const ads = resource('anuncios');
const requiredName = () => limits(120);
const backTo = (ctx, label) => ({label, open: () => ctx.go(ctx.area)});
const sortPath = (graph, a, b) => graph.path(a.id).localeCompare(graph.path(b.id), 'pt-BR');

export function optionsForCategories(items, {current, activeOnly = false, excluded = new Set()} = {}) {
  const graph = categoryGraph(items);
  return [...items].filter(item => !excluded.has(item.id)).sort((a, b) => sortPath(graph, a, b)).map(item => {
    const active = graph.active(item.id);
    return [item.id, `${graph.path(item.id)}${active ? '' : ' (inativa)'}`, activeOnly && !active && item.id !== current];
  });
}

export function categoriesView(ctx) {
  const create = () => button('Nova categoria', () => ctx.go('categorias', c => categoryEditor(c)), 'button primary');
  loadView(ctx, 'Categorias', create(), () => ctx.api.all(cats), categories => {
    const grouped = new Map();
    for (const category of categories) {
      const children = grouped.get(category.parentId) ?? [];
      children.push(category);
      grouped.set(category.parentId, children);
    }
    const graph = categoryGraph(categories);
    const tree = parent => h('ul', {class: 'tree', 'aria-label': parent === null ? 'Raízes da árvore' : 'Subcategorias'},
      (grouped.get(parent) ?? []).toSorted((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(node =>
        h('li', {}, h('div', {class: 'tree-row'}, h('div', {class: 'row-label'},
          button(node.name, () => ctx.go('categorias', child => categoryEditor(child, node.id)), 'tree-link',
            {'aria-label': `Editar categoria ${graph.path(node.id)}`}),
          text(node.slug, 'record-id muted')), badge(node.active ? 'Ativa' : 'Inativa', node.active ? 'complete' : 'neutral')),
        grouped.has(node.id) ? tree(node.id) : null)));
    ctx.body.append(heading('Categorias', 'Organize tipos, nichos e subnichos em uma árvore de até seis níveis.', create()),
      categories.length ? h('div', {class: 'tree-panel'}, tree(null)) :
        empty('Nenhuma categoria', 'Crie uma categoria raiz para organizar os primeiros anúncios.'));
  });
}

const categoryFields = record => ({name: record.name, parentId: record.parentId, active: record.active});
const categoryLabels = {name: 'Nome', parentId: 'Categoria pai', active: 'Categoria ativa'};

function categoryEditor(ctx, id, {parentId} = {}) {
  const back = backTo(ctx, 'Voltar às categorias');
  loadView(ctx, id ? 'Editar categoria' : 'Nova categoria', button(back.label, back.open),
    () => Promise.all([id ? ctx.api.request(resource('categorias', id)) : null, ctx.api.all(cats)]),
    ([record, categories]) => renderCategory(ctx, record, categories, {parentId}));
}

function renderCategory(ctx, record, items, {parentId, confirmation} = {}) {
  const back = backTo(ctx, 'Voltar às categorias');
  const graph = categoryGraph(items);
  const seed = categoryFields(record ?? {name: '', parentId: parentId ?? null, active: true});
  const replace = (saved, message) => ctx.go('categorias', child =>
    renderCategory(child, saved, items.some(node => node.id === saved.id)
      ? items.map(node => node.id === saved.id ? saved : node) : [...items, saved], {confirmation: message}), {force: true});
  const ed = editor(ctx, {title: record ? 'Editar categoria' : 'Nova categoria', back, initial: record,
    description: 'O slug é o identificador permanente da categoria. O nome visível pode mudar.',
    seed, labels: categoryLabels, fieldsFor: categoryFields,
    onReopen: latest => ctx.go('categorias', child => categoryEditor(child, latest.id), {force: true})});
  const {form, fields, messages} = ed;
  const parent = select('parentId', [['', 'Sem categoria pai (raiz)'], ...optionsForCategories(items, {
    activeOnly: true, current: seed.parentId, excluded: record ? graph.descendantsOf(record.id) : new Set()
  })], seed.parentId ?? '');
  const breadcrumb = text('', 'breadcrumb');
  function showPath() {
    const name = read(form, 'name') || 'Nova categoria';
    breadcrumb.textContent = parent.value ? `${graph.path(parent.value)} › ${name}` : name;
  }
  fields.append(h('legend', {}, 'Dados da categoria'),
    h('div', {class: 'edit-meta'}, versionBadge(record), breadcrumb),
    h('div', {class: 'form-grid'},
      field('Nome', input('name', seed.name, requiredName())),
      field('Slug', input('slug', record?.slug ?? '', {...limits(60), readOnly: Boolean(record), spellcheck: 'false', autocapitalize: 'none'}),
        {hint: record ? 'O slug não pode ser alterado.' : 'Ex.: bijuterias-artesanais'}),
      field('Categoria pai', parent, {wide: true, hint: 'Selecione um pai para criar ou mover um nicho.'}),
      check('active', 'Categoria ativa', seed.active)),
    text('Para inativar uma categoria, inative primeiro seus filhos e retire os anúncios publicados ligados a ela.', 'muted form-note'),
    h('div', {class: 'actions'}, submit(record ? 'Salvar alterações' : 'Criar categoria'),
      record?.active && graph.chain(record.id).length < 6
        ? button('Criar subcategoria', () => ctx.go('categorias', child => categoryEditor(child, null, {parentId: record.id}))) : null));
  showPath();
  form.addEventListener('input', showPath);
  ed.watch(() => snapshot(form));
  if (confirmation) messages.say(confirmation);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (ed.blocked() || ctx.busy()) return;
    const values = {name: read(form, 'name'), parentId: parent.value || null, active: checked(form, 'active')};
    const slug = read(form, 'slug');
    const errors = {};
    if (!values.name) errors.name = fieldHints.name;
    if (!record && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors.slug = fieldHints.slug;
    if (Object.keys(errors).length) return ed.invalidate(errors);
    const changes = diff(seed, values);
    if (record && !Object.keys(changes).length) return messages.say('Nenhuma alteração para salvar.');
    const data = record ? {version: record.version, ...changes} : {...values, slug};
    void ed.run('Salvando categoria…', () => ctx.api.request(resource('categorias', record?.id), {
      method: record ? 'PATCH' : 'POST', data
    }), {recordWrite: true, onDone: saved => replace(saved, record ? 'Categoria atualizada.' : 'Categoria criada.')});
  });
}

const stateBadge = state => badge(listingStates[state], state.toLowerCase());

export function listingsView(ctx) {
  const state = select('state', [['', 'Todos os estados'], ...Object.entries(listingStates)], ctx.state.listingFilter ?? '');
  const page = pager(ctx, {
    path: ads, filters: () => ({state: state.value}), area: 'anuncios',
    emptyTitle: 'Nenhum anúncio encontrado', emptyCopy: 'Escolha outro estado ou crie um rascunho.',
    row: listing => h('li', {class: 'row'},
      h('div', {class: 'row-label'}, h('strong', {}, listing.name),
        text(listing.mode === 'custom' ? 'Sob medida · sem preço' : h('span', {class: 'money'}, money(listing.priceCents)), 'muted')),
      h('div', {class: 'row-meta'}, stateBadge(listing.state)),
      button('Editar anúncio', () => ctx.go('anuncios', c => listingEditor(c, listing.id)), 'button secondary',
        {'aria-label': `Editar anúncio ${listing.name}`}))
  });
  state.addEventListener('change', () => { ctx.state.listingFilter = state.value; void page.load(); });
  ctx.body.append(heading('Anúncios', 'Crie rascunhos, organize fotos e escolha o que aparece na loja.',
    button('Novo anúncio', () => ctx.go('anuncios', c => listingEditor(c)), 'button primary')),
  band(h('div', {class: 'filters'}, field('Estado do anúncio', state))), page.node);
  void page.load();
}

function listingEditor(ctx, id) {
  const back = backTo(ctx, 'Voltar aos anúncios');
  loadView(ctx, id ? 'Editar anúncio' : 'Novo anúncio', button(back.label, back.open),
    () => Promise.all([id ? ctx.api.request(resource('anuncios', id)) : null, ctx.api.all(cats)]),
    ([record, categories]) => renderListing(ctx, record, categories));
}

const listingFields = listing => ({
  name: listing.name, categoryId: listing.categoryId, detail: listing.detail, description: listing.description,
  mode: listing.mode, priceCents: listing.priceCents, compareAtPriceCents: listing.compareAtPriceCents,
  variants: listing.variants, images: galleryFields(listing.gallery), state: listing.state
});
const listingLabels = {name: 'Nome', categoryId: 'Categoria', detail: 'Detalhe', description: 'Descrição',
  mode: 'Tipo de venda', priceCents: 'Preço de venda', compareAtPriceCents: 'Preço anterior',
  variants: 'Variantes', images: 'Fotos', state: 'Estado'};

function renderListing(ctx, initial, categories, confirmation) {
  let record = initial;
  let gallery = (record?.gallery ?? []).map(image => ({...image}));
  const seed = listingFields(record ?? {name: '', categoryId: '', detail: '', description: '', mode: 'ready',
    priceCents: null, compareAtPriceCents: null, variants: [], gallery: [], state: 'DRAFT'});
  const replace = (saved, message) => ctx.go('anuncios', child => renderListing(child, saved, categories, message), {force: true});
  const graph = categoryGraph(categories);
  const ed = editor(ctx, {title: record ? 'Editar anúncio' : 'Novo anúncio', back: backTo(ctx, 'Voltar aos anúncios'),
    description: record ? record.name : 'Salve o rascunho primeiro. Depois adicione fotos e publique.',
    initial: record, seed, labels: listingLabels, fieldsFor: listingFields,
    onReopen: latest => ctx.go('anuncios', child => listingEditor(child, latest.id), {force: true})});
  const {form, fields, messages} = ed;
  const mode = select('mode', [['ready', 'Pronta entrega'], ['custom', 'Sob medida (informativo)']], seed.mode);
  const category = select('categoryId', [['', 'Selecione na árvore'], ...optionsForCategories(categories, {
    current: seed.categoryId, activeOnly: true
  })], seed.categoryId);
  const price = input('priceCents', decimal(seed.priceCents), {inputmode: 'decimal', maxlength: 12});
  const compare = input('compareAtPriceCents', decimal(seed.compareAtPriceCents), {inputmode: 'decimal', maxlength: 12});
  const priceFields = [
    field('Preço de venda (R$)', price, {hint: 'Ex.: 89,90. Sem separador de milhar.'}),
    field('Preço anterior (R$)', compare, {hint: 'Opcional, acima do preço de venda.'})
  ];
  const noPrice = text('Encomendas são informativas, sem preço fechado ou checkout.', 'muted wide');
  function syncPrice() {
    const custom = mode.value === 'custom';
    for (const node of priceFields) node.hidden = custom;
    price.disabled = compare.disabled = custom;
    noPrice.hidden = !custom;
  }
  const version = versionBadge(record);
  fields.append(h('legend', {}, 'Dados do anúncio'),
    h('div', {class: 'edit-meta'}, record && stateBadge(record.state), version,
      record && h('code', {class: 'record-id'}, record.id)),
    h('div', {class: 'form-grid'},
      field('Nome', input('name', seed.name, requiredName())),
      field('Categoria', category, {hint: 'Os caminhos mostram os nichos criados em Categorias.'}),
      field('Detalhe curto', input('detail', seed.detail, limits(160)), {wide: true}),
      field('Descrição', textarea('description', seed.description, {...limits(3000), rows: 5}), {wide: true}),
      field('Tipo de venda', mode), noPrice, priceFields,
      field('Variantes', textarea('variants', seed.variants.join('\n'), {...limits(732), rows: 3}),
        {wide: true, hint: 'Opcional. Uma opção por linha, até 12 opções de 60 caracteres.'})));
  if (!categories.some(node => graph.active(node.id))) fields.append(band(text('Crie ou reative uma categoria antes de salvar.'),
    button('Ir para categorias', () => ctx.go('categorias'))));
  syncPrice();
  mode.addEventListener('change', syncPrice);

  const pictures = h('div', {class: 'pictures'});
  const upload = input('image', null, {type: 'file', accept: 'image/jpeg,image/png'});
  const clearFile = button('Limpar seleção', () => { upload.value = ''; clearFile.hidden = true; upload.focus(); },
    'button secondary', {hidden: true});
  upload.addEventListener('change', () => { clearFile.hidden = !upload.files.length; });
  const uploadForm = h('div', {class: 'upload-controls'},
    field('Arquivo da foto', upload, {hint: 'JPEG ou PNG estático. Até 3 MiB e 4 MP por foto.'}),
    button('Enviar foto', postImage, 'button secondary', {'data-record-write': true}), clearFile);
  if (record) {
    fields.append(h('section', {class: 'media-section'}, h('h2', {}, 'Fotos do anúncio'), pictures, uploadForm));
    drawGallery();
  }
  const actions = h('div', {class: 'actions save-row'},
    submit(record ? 'Salvar alterações' : 'Criar rascunho'),
    record?.state !== 'PUBLISHED' && record ? submit('Salvar e publicar', 'button secondary', 'PUBLISHED') : null,
    record?.state === 'PUBLISHED' ? submit('Salvar como rascunho', 'button secondary', 'DRAFT') : null,
    record && record.state !== 'INACTIVE' ? submit('Salvar e desativar', 'button secondary', 'INACTIVE') : null);
  fields.append(actions);
  ed.watch(() => `${snapshot(form)}|${Object.hasOwn(diff(seed, {images: galleryFields(gallery)}), 'images')}`);
  if (confirmation) messages.say(confirmation);

  function drawGallery(focusId, focusAction) {
    const livePictures = record.gallery.length;
    uploadForm.hidden = record.state === 'PUBLISHED' || livePictures >= 5;
    const explanation = record.state === 'PUBLISHED' ? 'Salve como rascunho para enviar fotos novas.'
      : livePictures >= 5 ? 'Limite de cinco fotos atingido. Remova uma e salve antes de enviar outra.'
      : 'O envio salva a foto no servidor. Depois complete texto alternativo e legenda, e salve as alterações.';
    pictures.replaceChildren(text(`${gallery.length} de 5 fotos · ${explanation}`, 'muted'), gallery.length
      ? h('ol', {class: 'gallery'}, gallery.map((image, i) => pictureRow(image, i)))
      : text('Nenhuma foto no anúncio.', 'form-note'));
    if (focusId) {
      const row = [...pictures.querySelectorAll('li')].find(node => node.dataset.image === focusId);
      const requested = row?.querySelector(`[data-action="${focusAction}"]`);
      (requested && !requested.disabled ? requested : row?.querySelector('.photo-alt'))?.focus();
    } else if (focusAction) {
      (uploadForm.hidden ? actions?.querySelector('button') : upload)?.focus();
    }
  }

  function pictureRow(image, i) {
    const path = safePhoto(image);
    const preview = path ? h('img', {src: path, alt: image.alt || '', loading: 'lazy', decoding: 'async',
      width: image.width, height: image.height}) : null;
    const frame = h('div', {class: 'preview'}, preview ?? text('Prévia indisponível.', 'muted'));
    preview?.addEventListener('error', () => frame.replaceChildren(text('Prévia indisponível.', 'muted')), {once: true});
    const alternative = input(null, image.alt, {...limits(240), class: 'photo-alt'});
    const caption = input(null, image.label, limits(80));
    alternative.addEventListener('input', () => {
      image.alt = alternative.value;
      if (preview) preview.alt = alternative.value;
    });
    caption.addEventListener('input', () => { image.label = caption.value; });
    const actions = h('div', {class: 'actions'},
      button('Subir', () => move(i, -1), 'button secondary', {disabled: i === 0, 'data-action': 'up', 'aria-label': `Subir foto ${i + 1}`}),
      button('Descer', () => move(i, 1), 'button secondary', {disabled: i === gallery.length - 1, 'data-action': 'down', 'aria-label': `Descer foto ${i + 1}`}),
      button('Remover', () => {
        gallery.splice(i, 1);
        drawGallery(gallery[Math.min(i, gallery.length - 1)]?.id, 'remove');
        messages.say('Foto removida do formulário. Salve para confirmar a remoção.');
      }, 'button secondary', {'data-action': 'remove', 'aria-label': `Remover foto ${i + 1}`}));
    return h('li', {'data-image': image.id}, frame, h('div', {class: 'photo-fields'},
      h('h3', {}, `Foto ${i + 1}`), field('Texto alternativo', alternative), field('Legenda', caption), actions));
  }

  function move(index, shift) {
    const next = index + shift;
    const photo = gallery[index];
    [gallery[index], gallery[next]] = [gallery[next], photo];
    drawGallery(photo.id, shift < 0 ? 'up' : 'down');
    messages.say(`Foto movida para a posição ${next + 1}. Salve para confirmar a ordem.`);
  }

  function postImage() {
    if (ctx.busy() || ed.blocked() || !record || uploadForm.hidden) return;
    const file = upload.files[0];
    if (!file || !['image/jpeg', 'image/png'].includes(file.type) || file.size === 0) {
      return ed.invalidate({image: 'Selecione um JPEG ou PNG estático não vazio.'});
    }
    if (file.size > maxPhotoBytes) return ed.invalidate({image: 'Selecione uma foto de até 3 MiB.'});
    const path = resource('anuncios', record.id);
    void ed.run('Enviando a foto para validação…', async () => {
      const latest = await ctx.api.request(path);
      if (latest.version !== record.version) throw new ApiError(409, 'VERSION_CONFLICT');
      const result = await ctx.api.request(`${path}/imagens`, {method: 'POST', file});
      if (!result?.image || result.version !== record.version + 1) throw new ApiError(409, 'VERSION_CONFLICT');
      return result;
    }, {recordWrite: true, alwaysReconcile: true, onDone: result => {
      const newPhoto = result.image;
      record = {...record, version: result.version, gallery: [...record.gallery, newPhoto]};
      seed.images = galleryFields(record.gallery);
      version.textContent = `Versão ${record.version}`;
      gallery.push({...newPhoto});
      upload.value = '';
      clearFile.hidden = true;
      drawGallery(newPhoto.id, 'alt');
      messages.say('Foto enviada. Preencha o texto alternativo e a legenda e salve.');
    }});
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (ctx.busy() || ed.blocked()) return;
    if (record && upload.files.length) return ed.invalidate({image: 'Envie a foto selecionada ou limpe a seleção antes de salvar.'});
    const target = event.submitter?.value || seed.state;
    const custom = mode.value === 'custom';
    const p = custom ? null : unitsFromDecimal(price.value, {min: 1, max: productLimit});
    const c = custom ? null : unitsFromDecimal(compare.value, {min: (p ?? 0) + 1, max: productLimit, blank: null});
    const variants = read(form, 'variants').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const values = {name: read(form, 'name'), categoryId: category.value, detail: read(form, 'detail'),
      description: read(form, 'description'), mode: mode.value, priceCents: p, compareAtPriceCents: c, variants};
    const errors = {};
    if (!values.name) errors.name = fieldHints.name;
    if (!values.description) errors.description = fieldHints.description;
    if (!graph.active(category.value)) errors.categoryId = fieldHints.categoryId;
    if (p === undefined) errors.priceCents = fieldHints.priceCents;
    if (c === undefined) errors.compareAtPriceCents = fieldHints.compareAtPriceCents;
    if (variants.length > 12 || variants.some(value => value.length > 60) || new Set(variants).size !== variants.length) {
      errors.variants = fieldHints.variants;
    }
    const images = galleryFields(gallery).map(image => ({...image, alt: image.alt.trim(), label: image.label.trim()}));
    const changes = diff(seed, {...values, ...(record ? {images, state: target} : {})});
    if ((target === 'PUBLISHED' || Object.hasOwn(changes, 'images')) && images.some(image => !image.alt || !image.label)) {
      errors.images = fieldHints.images;
    }
    if (target === 'PUBLISHED' && !images.length) errors.images = 'Adicione pelo menos uma foto antes de publicar.';
    if (Object.keys(errors).length) return ed.invalidate(errors);
    if (record && !Object.keys(changes).length) return messages.say('Nenhuma alteração para salvar.');
    const data = record ? {version: record.version, ...changes} : values;
    void ed.run('Salvando anúncio…', () => ctx.api.request(resource('anuncios', record?.id), {
      method: record ? 'PATCH' : 'POST', data
    }), {recordWrite: true, onDone: saved => replace(saved, !record ? 'Rascunho criado. Agora você pode enviar fotos.'
      : target !== seed.state ? `Anúncio salvo como ${listingStates[saved.state].toLowerCase()}.` : 'Anúncio atualizado.')});
  });
}
