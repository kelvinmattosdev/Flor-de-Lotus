import {resource} from './api.js';
import {date, money, nextStatus, statusNames, statuses} from './domain.js';
import {alerts, badge, band, button, dl, field, h, heading, loadView, pager, select, text} from './ui.js';

const orderId = id => `#${id.slice(0, 8).toUpperCase()}`;
const stateBadge = status => badge(statusNames[status] ?? 'Desconhecido', status.toLowerCase());
const stamp = value => h('time', {datetime: value}, date(value));
const cash = ({totalCents}) => h('strong', {class: 'money'}, money(totalCents));
const customerLabel = customer => customer.nickname == null
  ? `Nome de usuário: ${customer.login}` : `${customer.nickname} · Nome de usuário: ${customer.login}`;
const showOrders = (ctx, customer) => {
  ctx.state.orderFilters = {customerId: customer?.id ?? '', customer, status: ''};
  ctx.go('pedidos');
};

export function customersView(ctx) {
  const page = pager(ctx, {
    path: resource('clientes'), filters: () => ({}), area: 'clientes',
    emptyTitle: 'Nenhum cliente de teste',
    emptyCopy: 'Contas de demonstração criadas na loja aparecem aqui.',
    row: customer => h('li', {class: 'row'},
      h('div', {class: 'row-label'}, h('strong', {}, customerLabel(customer)), text('Conta de cliente', 'muted')),
      h('div', {class: 'row-meta'}, stamp(customer.createdAt)),
      button('Ver pedidos', () => showOrders(ctx, customer), 'button secondary',
        {'aria-label': `Ver pedidos de ${customer.login}`}))
  });
  ctx.body.append(heading('Clientes', 'Contas de teste da loja. Apelido e nome de usuário são campos separados.'), page.node);
  void page.load();
}

export function ordersView(ctx) {
  const saved = ctx.state.orderFilters ??= {status: '', customerId: '', customer: null};
  const filterState = select('status', [['', 'Todos os status'], ...statuses.map(s => [s, statusNames[s]])], saved.status);
  const customerOptions = [['', 'Todos os clientes']];
  if (saved.customerId && saved.customer) customerOptions.push([saved.customerId, customerLabel(saved.customer)]);
  const customer = select('customerId', customerOptions, saved.customerId);
  const customerNotice = alerts();
  const listCustomers = button('Listar clientes', loadCustomers);
  const page = pager(ctx, {
    path: resource('pedidos'), filters: () => ({status: saved.status, customerId: saved.customerId}), area: 'pedidos',
    emptyTitle: 'Nenhum pedido encontrado',
    emptyCopy: 'Tente outro filtro ou aguarde uma compra simulada na loja.',
    row: order => h('li', {class: 'row order-row'}, h('div', {class: 'row-label'},
      h('strong', {}, orderId(order.id), ' · ', customerLabel(order.customer)), text(stamp(order.createdAt), 'muted')),
    h('div', {class: 'row-meta'}, stateBadge(order.status), cash(order)),
    button('Abrir pedido', () => ctx.go('pedidos', child => orderView(child, order.id)), 'button secondary',
      {'aria-label': `Abrir pedido ${orderId(order.id)} de ${order.customer.login}`}))
  });

  async function loadCustomers() {
    if (listCustomers.disabled) return;
    listCustomers.disabled = true;
    customerNotice.say('Carregando os nomes de usuário e apelidos de teste…');
    try {
      const customers = await ctx.api.all(resource('clientes'));
      if (!ctx.active()) return;
      const options = customers.map(item => h('option', {value: item.id}, customerLabel(item)));
      const byId = new Map(customers.map(item => [item.id, item]));
      customer.addEventListener('change', () => { saved.customer = byId.get(customer.value) ?? null; });
      if (saved.customerId && !customers.some(item => item.id === saved.customerId)) {
        options.unshift(h('option', {value: saved.customerId}, saved.customer?.login ?? 'Cliente selecionado'));
      }
      customer.replaceChildren(h('option', {value: ''}, 'Todos os clientes'), ...options);
      customer.value = saved.customerId;
      customerNotice.say(customers.length ? 'Nomes de usuário e apelidos disponíveis no filtro.' : 'Ainda não há clientes de teste.');
      if (document.activeElement === document.body || document.activeElement === listCustomers) customer.focus();
      listCustomers.hidden = true;
    } catch (error) {
      if (!ctx.active()) return;
      const copy = await ctx.issue(error, 'pedidos');
      if (ctx.active() && copy) customerNotice.fail(copy);
    } finally {
      listCustomers.disabled = false;
    }
  }
  filterState.addEventListener('change', () => { saved.status = filterState.value; void page.load(); });
  customer.addEventListener('change', () => {
    saved.customerId = customer.value;
    if (!customer.value) saved.customer = null;
    void page.load();
  });
  ctx.body.append(heading('Pedidos', 'Acompanhe os quatro passos das compras simuladas. Nenhuma atualização aciona entrega.'),
    band(h('div', {class: 'filters'},
      field('Status', filterState), field('Cliente', customer), listCustomers), customerNotice.node), page.node);
  void page.load();
}

function timeline(order) {
  const events = new Map(order.statusHistory.map(event => [event.status, event.createdAt]));
  return h('ol', {class: 'timeline', 'aria-label': 'Progresso simulado do pedido'}, statuses.map((status, index) => {
    const current = order.status === status;
    const done = events.has(status);
    return h('li', {class: done ? 'complete' : 'pending', 'aria-current': current ? 'step' : null},
      h('span', {class: 'step-number', 'aria-hidden': 'true'}, String(index + 1).padStart(2, '0')),
      h('div', {}, h('strong', {}, statusNames[status]),
        h('span', {class: 'step-date'}, current ? 'Etapa atual · ' : '', done ? stamp(events.get(status)) : 'Ainda não atingida')));
  }));
}

function orderView(ctx, id) {
  const path = resource('pedidos', id);
  const back = () => button('Voltar aos pedidos', () => ctx.go('pedidos'));
  loadView(ctx, 'Detalhe do pedido', back(), () => ctx.api.request(path), render);

  function render(initial) {
    const content = h('div', {class: 'detail-content'});
    const messages = alerts();
    const actions = h('div', {class: 'actions'});
    ctx.body.append(heading(`Pedido ${orderId(id)}`, 'Registro demonstrativo · sem cobrança nem entrega real.', back()),
      messages.node, content);
    draw(initial);

    function draw(order) {
      const next = nextStatus(order.status);
      actions.replaceChildren();
      const advance = next ? button(`Avançar para ${statusNames[next].toLowerCase()}`, () => advanceStatus(order),
        'button primary') : null;
      const refresh = button('Atualizar pedido', update);
      actions.append(...[advance, refresh].filter(Boolean));
      const progress = h('section', {class: 'panel'},
        h('div', {class: 'section-title'}, h('h2', {}, 'Progresso do pedido'), stateBadge(order.status)),
        timeline(order), actions);
      const items = h('section', {class: 'panel'}, h('h2', {}, 'Itens na compra'),
        text('Nome, variante e valores registrados quando a compra foi simulada.', 'muted'),
        h('ul', {class: 'rows item-rows'}, order.items.map(item => h('li', {class: 'row'},
          h('div', {class: 'row-label'}, h('strong', {}, item.name),
            text(item.variant ? `Variante: ${item.variant}` : 'Sem variante', 'muted'),
            text(item.productId, 'record-id')),
          dl([['Quantidade', item.quantity], ['Preço unitário', money(item.unitPriceCents)],
            ['Subtotal', money(item.subtotalCents)], ['Desconto', money(item.discountCents)], ['Total do item', money(item.totalCents)]])))));
      const totals = h('section', {class: 'panel'}, h('h2', {}, 'Valores registrados'),
        dl([['Subtotal dos itens', money(order.subtotalCents)], ['Desconto nos itens', money(order.merchDiscountCents)],
          [`Frete simulado · ${order.shippingName}`, money(order.shippingCents)], ['Desconto no frete', money(order.shippingDiscountCents)],
          ['Total simulado', cash(order)]]), h('h3', {}, 'Cupons aplicados'),
        order.appliedCoupons.length ? h('ul', {class: 'coupon-snapshots'}, order.appliedCoupons.map(c =>
          h('li', {}, h('code', {}, c.code), ' · Itens: ', money(c.merchDiscountCents), ' · Frete: ', money(c.shippingDiscountCents))))
          : text('Nenhum cupom aplicado.', 'muted'));
      const record = h('section', {class: 'panel'}, h('h2', {}, 'Registro da compra'),
        dl([['Pedido', h('code', {class: 'record-id'}, order.id)], ['Nome de usuário', order.customer.login],
          ['Apelido', order.customer.nickname ?? 'Não informado'], ['Nome completo', order.recipientFullName ?? 'Não informado'],
          ['Pedido criado em', stamp(order.createdAt)], ['Compra', h('code', {class: 'record-id'}, order.purchase.id)],
          ['Compra registrada em', stamp(order.purchase.createdAt)],
          ['Pagamento', order.purchase.paymentMethod === 'PIX_SIMULADO' ? 'Pix simulado' : 'Cartão simulado'],
          ['Natureza do registro', 'Simulado']]));
      content.replaceChildren(progress, items, h('div', {class: 'split-content'}, totals, record));

      async function update() {
        await perform('Consultando o pedido…', () => ctx.api.request(path), 'Pedido atualizado.', false);
      }

      async function advanceStatus(from) {
        await perform('Salvando o próximo status…', () => ctx.api.request(`${path}/status`, {
          method: 'PATCH', data: {expectedStatus: from.status, to: next}
        }), `Status atualizado para ${statusNames[next]}.`, true);
      }

      async function perform(start, operation, success, write) {
        if (ctx.busy()) return;
        const controls = [advance, refresh].filter(Boolean);
        const origin = document.activeElement;
        const prior = advance?.disabled;
        ctx.setBusy(true);
        controls.forEach(control => { control.disabled = true; });
        messages.say(start);
        let focus;
        try {
          const current = await operation();
          if (!ctx.active()) return;
          messages.say(success);
          draw(current);
          focus = actions.querySelector(write ? 'button' : 'button:last-child');
        } catch (error) {
          if (!ctx.active()) return;
          const copy = await ctx.issue(error, 'pedidos');
          if (!ctx.active() || !copy) return;
          if (advance) advance.disabled = prior || (write && (error.status === 409 || !error.status || error.status >= 500));
          focus = advance?.disabled ? refresh : origin;
          messages.fail(copy);
        } finally {
          if (ctx.active()) {
            ctx.setBusy(false);
            refresh.disabled = false;
            focus?.focus();
          }
        }
      }
    }
  }
}
