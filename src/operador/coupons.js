import {resource} from './api.js';
import {optionsForCategories} from './catalog.js';
import {couponLimit, decimal, diff, listingStates, money, normalizedCode, percent, scopes, unitsFromDecimal} from './domain.js';
import {checked, editor, fieldHints, read, snapshot, versionBadge} from './editor.js';
import {alerts, badge, button, check, field, h, heading, input, loadView, pager,
  select, submit, text} from './ui.js';

const coupons = resource('cupons');
const strip = ({code, id, version, ...editable}) => editable;
const labels = {scope: 'Escopo', scopeId: 'Alvo', includeDescendants: 'Incluir descendentes', minSubtotalCents: 'Subtotal mínimo',
  maxDiscountCents: 'Teto do desconto', percentBps: 'Percentual de desconto', freeShipping: 'Frete grátis',
  stackable: 'Combinação', active: 'Ativação'};
const newCoupon = {scope: 'GLOBAL', scopeId: null, includeDescendants: false, minSubtotalCents: 0,
  maxDiscountCents: null, percentBps: 0, freeShipping: false, stackable: false, active: true};

const backTo = ctx => ({label: 'Voltar aos cupons', open: () => ctx.go('cupons')});
const benefits = offer => [offer.percentBps ? percent(offer.percentBps) : '', offer.freeShipping ? 'Frete grátis' : ''].filter(Boolean).join(' + ');

function policy() {
  return h('details', {class: 'policy'}, h('summary', {}, 'Como a loja aplica os cupons'),
    h('ul', {},
      h('li', {}, 'Até cinco códigos distintos por sacola. A loja escolhe a maior economia entre os conjuntos elegíveis; empates favorecem menos códigos e depois a ordem ASCII.'),
      h('li', {}, 'Por padrão, um cupom é exclusivo. Só combina quando os dois aceitam combinação e existe uma regra bilateral Permitir. Bloquear ou ficar sem regra impede a combinação.'),
      h('li', {}, 'O mínimo é o subtotal dos itens elegíveis antes dos cupons, sem frete. O teto limita o desconto percentual, não o frete.'),
      h('li', {}, 'O percentual vale sobre o saldo elegível: primeiro anúncio, depois categoria, depois toda a loja. Cada desconto é arredondado para baixo em centavos.'),
      h('li', {}, 'O frete demonstrativo é calculado por último. Se mais de um cupom selecionado oferece frete grátis, uma única tarifa é zerada.')));
}

export function couponsView(ctx) {
  const page = pager(ctx, {
    path: coupons, filters: () => ({}), area: 'cupons',
    emptyTitle: 'Nenhum cupom cadastrado', emptyCopy: 'Crie um código para aplicar na sacola da loja.',
    row: offer => h('li', {class: 'row'},
      h('div', {class: 'row-label'}, h('code', {}, offer.code),
        text(`${scopes[offer.scope]} · ${benefits(offer)}`, 'muted')),
      h('div', {class: 'row-meta'}, badge(offer.active ? 'Ativo' : 'Inativo', offer.active ? 'complete' : 'neutral')),
      button('Editar cupom', () => ctx.go('cupons', child => couponEditor(child, offer.id)), 'button secondary',
        {'aria-label': `Editar cupom ${offer.code}`}))
  });
  ctx.body.append(heading('Cupons', 'Cadastre os códigos usados na sacola e revise quais podem ser combinados.',
    button('Novo cupom', () => ctx.go('cupons', child => couponEditor(child)), 'button primary')),
  policy(), page.node);
  void page.load();
}

function couponEditor(ctx, id) {
  const back = backTo(ctx);
  loadView(ctx, id ? 'Editar cupom' : 'Novo cupom', button(back.label, back.open),
    () => Promise.all([id ? ctx.api.request(resource('cupons', id)) : null, ctx.api.all(resource('categorias'))]),
    ([record, categories]) => renderCoupon(ctx, record, categories));
}

function renderCoupon(ctx, record, categories, confirmation, knownAds) {
  const seed = record ? strip(record) : newCoupon;
  const ed = editor(ctx, {title: record ? 'Editar cupom' : 'Novo cupom', back: backTo(ctx),
    description: record ? `O código que o cliente digita na loja é ${record.code}.` : 'Escolha o benefício, os alvos e as condições do código que será usado na sacola.',
    initial: record, seed, labels, fieldsFor: strip,
    onReopen: latest => ctx.go('cupons', child => couponEditor(child, latest.id), {force: true})});
  const {form, fields, messages} = ed;
  const scope = select('scope', Object.entries(scopes), seed.scope);
  const target = select('scopeId', [], '');
  const targetField = field('Alvo do cupom', target, {hint: 'Escolha pelo nome. Rascunhos e inativos não aparecem na loja.'});
  const descendants = check('includeDescendants', 'Incluir nichos e subnichos desta categoria',
    seed.scope === 'CATEGORY' ? seed.includeDescendants : true);
  const picked = new Map([[seed.scope, seed.scopeId ?? '']]);
  const account = alerts();
  const loadAds = button('Listar anúncios para selecionar', findAds);
  let ads = knownAds;
  let loading = false;

  function syncScope() {
    const current = scope.value;
    const category = current === 'CATEGORY';
    targetField.hidden = current === 'GLOBAL';
    target.disabled = current === 'GLOBAL' || (current === 'PRODUCT' && !ads);
    const include = descendants.querySelector('input');
    descendants.hidden = !category;
    include.disabled = !category;
    loadAds.hidden = current !== 'PRODUCT' || Boolean(ads);
    account.node.hidden = current !== 'PRODUCT';
    const options = category ? optionsForCategories(categories) : (ads ?? []).toSorted((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map(row => [row.id, `${row.name} · ${listingStates[row.state]} · ${row.id}`]);
    const placeholder = current === 'PRODUCT' && !ads ? 'Liste os anúncios primeiro' : 'Selecione um alvo';
    target.replaceChildren(h('option', {value: ''}, placeholder), ...options.map(([id, name]) => h('option', {value: id}, name)));
    target.value = picked.get(current) ?? '';
  }

  async function findAds() {
    if (loading) return;
    const origin = document.activeElement;
    loading = true;
    loadAds.disabled = true;
    account.say('Carregando todos os anúncios…');
    try {
      const entries = await ctx.api.all(resource('anuncios'));
      if (!ctx.active()) return;
      ads = entries;
      if (!entries.length) account.say('Nenhum anúncio disponível. Crie um anúncio ou mude o escopo.');
      else account.say(`${entries.length} ${entries.length === 1 ? 'anúncio disponível' : 'anúncios disponíveis'}.`);
      syncScope();
      if (scope.value === 'PRODUCT' && origin === loadAds && document.activeElement === document.body) target.focus();
    } catch (error) {
      if (!ctx.active()) return;
      const copy = await ctx.issue(error, 'cupons');
      if (ctx.active() && copy) account.fail(copy);
    } finally {
      loading = false;
      loadAds.disabled = false;
    }
  }
  scope.addEventListener('change', () => {
    syncScope();
    if (scope.value === 'PRODUCT' && !ads) void findAds();
  });
  target.addEventListener('change', () => picked.set(scope.value, target.value));
  const code = input('code', record?.code ?? '', {maxlength: 32, readOnly: Boolean(record), autocapitalize: 'characters', spellcheck: 'false'});
  code.addEventListener('blur', () => { if (!record) code.value = normalizedCode(code.value) ?? code.value; });
  fields.append(h('legend', {}, 'Dados do cupom'), h('div', {class: 'edit-meta'},
    versionBadge(record), record && badge(record.active ? 'Ativo na loja' : 'Inativo', record.active ? 'complete' : 'neutral')),
  h('div', {class: 'form-grid'},
    field('Código do cupom', code, {hint: record ? 'O código é imutável.' : 'De 2 a 32 letras sem acento, números ou hífens. Será salvo em maiúsculas.'}),
    field('Escopo', scope),
    targetField, descendants, h('div', {class: 'wide load-picker'}, loadAds, account.node),
    field('Percentual de desconto (%)', input('percentBps', decimal(seed.percentBps), {inputmode: 'decimal', maxlength: 6}),
      {hint: 'Ex.: 12,5. Use 0 se o benefício for somente frete grátis.'}),
    field('Subtotal mínimo elegível (R$)', input('minSubtotalCents', decimal(seed.minSubtotalCents), {inputmode: 'decimal', maxlength: 12}),
      {hint: 'Sem frete, antes dos cupons. Vazio equivale a zero.'}),
    field('Teto do desconto (R$)', input('maxDiscountCents', decimal(seed.maxDiscountCents), {inputmode: 'decimal', maxlength: 12}),
      {hint: 'Opcional. Limita apenas o desconto percentual.'}),
    h('div', {class: 'options wide'}, check('freeShipping', 'Oferece frete grátis', seed.freeShipping),
      check('stackable', 'Aceita combinar com outros cupons', seed.stackable), check('active', 'Ativo na loja', seed.active))),
  h('div', {class: 'actions'}, submit(record ? 'Salvar alterações' : 'Criar cupom'),
    record?.active ? submit('Salvar e desativar', 'button secondary', 'deactivate') : null));
  syncScope();
  // Async hydration of the target select is not a change by the operator.
  ed.watch(() => `${snapshot(form, ['scopeId'])}|${picked.get(scope.value) ?? ''}`);
  if (seed.scope === 'PRODUCT' && !ads) void findAds();
  if (confirmation) messages.say(confirmation);
  if (record) renderPairs(ctx, record);
  ctx.body.append(policy());

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (ctx.busy() || ed.blocked()) return;
    const type = scope.value;
    const codeValue = record ? record.code : normalizedCode(code.value);
    const discount = unitsFromDecimal(read(form, 'percentBps'), {max: 10000, blank: 0});
    const min = unitsFromDecimal(read(form, 'minSubtotalCents'), {max: couponLimit, blank: 0});
    const max = unitsFromDecimal(read(form, 'maxDiscountCents'), {min: 1, max: couponLimit, blank: null});
    const free = checked(form, 'freeShipping');
    const values = {scope: type, scopeId: type === 'GLOBAL' ? null : target.value,
      includeDescendants: type === 'CATEGORY' && checked(form, 'includeDescendants'), minSubtotalCents: min,
      maxDiscountCents: max, percentBps: discount, freeShipping: free,
      stackable: checked(form, 'stackable'), active: event.submitter?.value !== 'deactivate' && checked(form, 'active')};
    const errors = {};
    if (!codeValue) errors.code = fieldHints.code;
    if (targetField.hidden === false && !target.value) errors.scopeId = fieldHints.scopeId;
    if (discount === undefined || (!discount && !free)) errors.percentBps = fieldHints.percentBps;
    if (min === undefined) errors.minSubtotalCents = fieldHints.minSubtotalCents;
    if (max === undefined || (max !== null && !discount)) errors.maxDiscountCents = fieldHints.maxDiscountCents;
    if (Object.keys(errors).length) return ed.invalidate(errors);
    const changes = diff(seed, values);
    if (record && !Object.keys(changes).length) return messages.say('Nenhuma alteração para salvar.');
    const data = record ? {version: record.version, ...changes} : {...values, code: codeValue};
    void ed.run('Salvando cupom…', () => ctx.api.request(resource('cupons', record?.id), {
      method: record ? 'PATCH' : 'POST', data
    }), {recordWrite: true, onDone: saved => ctx.go('cupons', child => renderCoupon(child, saved, categories,
      saved.active ? `Cupom ${saved.code} salvo. Use este código na sacola.` : `Cupom ${saved.code} salvo como inativo.`, ads),
    {force: true})});
  });
}

const ruleNames = {'': 'Sem regra (não combina)', ALLOW: 'Permitir', DENY: 'Bloquear'};

function renderPairs(ctx, offer) {
  const path = `${resource('cupons', offer.id)}/pares`;
  const messages = alerts();
  const content = h('div');
  const loadButton = button('Consultar regras', load);
  const section = h('section', {class: 'panel pair-section'}, h('h2', {}, 'Regras entre cupons'),
    text('A regra é bilateral: mudar aqui também muda no outro cupom. Permitir não tem efeito se um dos dois estiver inativo ou não aceitar combinação.', 'muted'),
    loadButton, messages.node, content);
  ctx.body.append(section);
  let reading = false;
  let uncertain = false;
  async function load() {
    if (reading || ctx.busy()) return;
    reading = true;
    loadButton.disabled = true;
    const origin = document.activeElement;
    messages.say('Carregando cupons e regras…');
    try {
      const [offers, pairs] = await Promise.all([ctx.api.all(coupons), ctx.api.all(path)]);
      if (!ctx.active()) return;
      uncertain = false;
      draw(offers.filter(other => other.id !== offer.id), new Map(pairs.map(pair => [pair.otherCouponId, pair.rule])));
      messages.say('Regras consultadas.');
      loadButton.textContent = 'Atualizar regras';
      if (origin === loadButton && document.activeElement === document.body) {
        (content.querySelector('select') ?? loadButton).focus();
      }
    } catch (error) {
      if (!ctx.active()) return;
      const copy = await ctx.issue(error, 'cupons');
      if (ctx.active() && copy) messages.fail(copy);
    } finally {
      reading = false;
      loadButton.disabled = false;
    }
  }

  function draw(others, rules) {
    if (!others.length) {
      content.replaceChildren(h('div', {class: 'pair-empty'}, h('h3', {}, 'Não há outro cupom'),
        text('Crie outro código para configurar um par.', 'muted')));
      return;
    }
    const other = select('otherId', [['', 'Selecione pelo código'], ...others.toSorted((a, b) => a.code.localeCompare(b.code, 'pt-BR'))
      .map(item => [item.id, `${item.code}${item.active ? '' : ' (inativo)'}`])]);
    const rule = select('rule', Object.entries(ruleNames));
    const description = text('', 'muted');
    const save = submit('Salvar regra do par');
    const configured = h('ul', {class: 'simple-list'});
    const none = text('Nenhum par tem regra explícita.', 'muted');
    const editorFields = h('fieldset', {class: 'pair-fields'},
      h('div', {class: 'form-grid'}, field('Outro cupom', other), field('Regra bilateral', rule)), description, save);
    const form = h('form', {method: 'post', class: 'pair-form'}, editorFields);

    function drawRules() {
      configured.replaceChildren(...others.filter(item => rules.has(item.id))
        .map(item => h('li', {}, h('code', {}, item.code), ' · ', ruleNames[rules.get(item.id)])));
      configured.hidden = !configured.childElementCount;
      none.hidden = Boolean(configured.childElementCount);
    }
    function pickRule() {
      const selected = others.find(item => item.id === other.value);
      rule.value = selected ? rules.get(selected.id) ?? '' : '';
      rule.disabled = !selected;
      save.disabled = !selected || uncertain;
      description.textContent = !selected ? 'Escolha o outro cupom para ver ou editar a regra.'
        : `Regra salva: ${ruleNames[rules.get(selected.id) ?? '']}. ${offer.stackable && selected.stackable
          ? 'Os dois cupons aceitam combinação.'
          : 'Ao menos um dos cupons não aceita combinação nas configurações do próprio cupom.'}`;
    }
    drawRules();
    pickRule();
    other.addEventListener('change', pickRule);
    content.replaceChildren(h('div', {class: 'rules-list'}, h('h3', {}, 'Pares configurados'), configured, none), form);

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (ctx.busy() || reading || uncertain || !other.value) return;
      const selected = other.value;
      const desired = rule.value || null;
      if (desired === (rules.get(selected) ?? null)) return messages.say('Nenhuma alteração na regra do par.');
      ctx.setBusy(true);
      editorFields.disabled = true;
      loadButton.disabled = true;
      messages.say('Salvando regra bilateral…');
      let focus = save;
      try {
        await ctx.api.request(`${path}/${encodeURIComponent(selected)}`, {method: 'PUT', data: {rule: desired}});
        if (!ctx.active()) return;
        if (desired === null) rules.delete(selected);
        else rules.set(selected, desired);
        drawRules();
        pickRule();
        messages.say(desired ? 'Regra bilateral salva.' : 'Regra removida. Os dois cupons não combinam entre si.');
      } catch (error) {
        if (!ctx.active()) return;
        const copy = await ctx.issue(error, 'cupons');
        if (!ctx.active() || !copy) return;
        uncertain = !error.status || error.status >= 500 || error.status === 409;
        if (uncertain) { save.disabled = true; focus = loadButton; }
        messages.fail(uncertain ? `${copy} Atualize as regras antes de outro envio.` : copy);
      } finally {
        if (ctx.active()) {
          ctx.setBusy(false);
          editorFields.disabled = false;
          loadButton.disabled = false;
          focus.focus();
        }
      }
    });
  }
}
