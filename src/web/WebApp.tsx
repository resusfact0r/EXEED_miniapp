import { Checkout } from './Checkout';
import { Warehouse } from './Warehouse';
import { historyList } from './orders';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CarMap } from './CarMap';
import { AssemblyMap } from './AssemblyMap';
import { Icon } from './Icons';
import { findProduct, findProducts, loadCatalog, money, supportUrl, type CatalogSession, type NavigationProduct, type WebFilters } from './catalog';
import { addToBag, changeBagQuantity, maxQuantity, parseSavedBag, storageKey, type BagItem } from './basket';
import './web.css';

type Modal = 'checkout' | 'orders' | 'cart' | 'help' | 'delivery' | null;
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
const emptyFilters: WebFilters = { brand: '', model: '', category: '', query: '', page: 1, pageSize: 12, sort: 'name', inStock: false };

function safeImageUrl(value: string | null | undefined) {
  if (!value) return '';
  try { const url = new URL(value, location.origin); return url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === location.origin) ? url.href : ''; }
  catch { return ''; }
}

function initialFilters(): WebFilters {
  const params = new URLSearchParams(location.search);
  const page = Number(params.get('page') ?? 1);
  const sort = params.get('sort') ?? 'name';
  return { ...emptyFilters, brand: params.get('brand') ?? '', model: params.get('model') ?? '', category: params.get('category') ?? '', query: (params.get('q') ?? '').slice(0, 200), page: Number.isSafeInteger(page) && page > 0 ? page : 1, sort: ['name', 'price-asc', 'price-desc'].includes(sort) ? sort : 'name', inStock: params.get('stock') === '1' };
}

function readBag() {
  try { return parseSavedBag(localStorage.getItem(storageKey)); }
  catch { return []; }
}

function Dialog({ title, children, onClose, feedback }: { title: string; children: ReactNode; onClose: () => void; feedback: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = ref.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => { element.close(); document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, []);
  return <dialog ref={ref} className="web-dialog" aria-labelledby={id} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-body"><div className="dialog-header"><h2 id={id}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Закрыть окно"><Icon name="close"/></button></div>{children}{feedback && <p className="dialog-feedback" role="status">{feedback}</p>}</div>
  </dialog>;
}

export function WebApp() {
  return new URLSearchParams(location.search).has('warehouse') ? <Warehouse/> : <Store/>;
}
function Store() {
  const [catalog, setCatalog] = useState<CatalogSession>();
  const [filters, setFilters] = useState<WebFilters>(initialFilters);
  const [search, setSearch] = useState(filters.query ?? '');
  const [items, setItems] = useState<NavigationProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [bag, setBag] = useState<BagItem[]>(readBag);
  const bagRef = useRef(bag);
  const returning=Number(new URLSearchParams(location.search).get('webOrder')) || undefined;
  const [selectedOrder,setSelectedOrder]=useState<number|undefined>(returning);
  const [modal,setModal]=useState<Modal>(returning?'checkout':null);
  const [detail, setDetail] = useState<NavigationProduct | null>(null);
  const [toast, setToast] = useState('');
  const detailRequest = useRef(0);
  const resultsRef = useRef<HTMLElement>(null);
  const metadata = catalog?.metadata;
  const source = catalog?.source;
  const currentBrand = metadata?.brands.find((brand) => brand.name === filters.brand);
  const currentCategory = metadata?.categories.find((category) => category.id === filters.category);
  const itemCount = bag.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = bag.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
  const hasFilters = Boolean(filters.brand || filters.model || filters.category || filters.query || filters.inStock || filters.sort !== 'name');

  useEffect(() => {
    let active = true;
    setCatalog(undefined); setLoading(true); setError('');
    loadCatalog().then((session) => {
      if (!active) return;
      setFilters((current) => {
        const brand = session.metadata.brands.find((candidate) => candidate.name === current.brand);
        const model = brand?.models.includes(current.model ?? '') ? current.model : '';
        const category = session.metadata.categories.some((candidate) => candidate.id === current.category) ? current.category : '';
        return current.brand === (brand?.name ?? '') && current.model === model && current.category === category ? current : { ...current, brand: brand?.name ?? '', model, category, page: 1 };
      });
      setCatalog(session);
    }).catch(() => { if (active) { setError('Не удалось загрузить каталог. Проверьте соединение и попробуйте ещё раз.'); setLoading(false); } });
    return () => { active = false; };
  }, [retry]);

  useEffect(() => {
    if (!catalog) return;
    let active = true;
    let redirected = false;
    setLoading(true); setError('');
    findProducts(filters, catalog.source).then((result) => {
      if (!active) return;
      if ((filters.page ?? 1) > Math.max(1, Math.ceil(result.total / 12))) { redirected = true; setFilters((current) => ({ ...current, page: 1 })); return; }
      setItems(result.items); setTotal(result.total);
    }).catch(() => { if (active) setError('Не удалось получить детали. Попробуйте ещё раз.'); }).finally(() => { if (active && !redirected) setLoading(false); });
    const params = new URLSearchParams(location.search);
    const values = { brand: filters.brand, model: filters.model, category: filters.category, q: filters.query, page: filters.page === 1 ? '' : String(filters.page), sort: filters.sort === 'name' ? '' : filters.sort, stock: filters.inStock ? '1' : '' };
    for (const [key, value] of Object.entries(values)) { if (value) params.set(key, value); else params.delete(key); }
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    return () => { active = false; };
  }, [catalog, filters]);

  useEffect(() => {
    if (!catalog) return;
    const code = new URLSearchParams(location.search).get('part');
    if (!code) return;
    const request = ++detailRequest.current;
    void findProduct(code, catalog.source).then((product) => { if (request === detailRequest.current) setDetail(product); }).catch(() => { if (request === detailRequest.current) setToast('Деталь по этой ссылке не найдена'); });
    return () => { detailRequest.current++; };
  }, [catalog]);

  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(bag)); } catch { /* Browsing still works when storage is unavailable. */ } }, [bag]);
  useEffect(() => { if (toast) { const timer = window.setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); } }, [toast]);

  function update(next: Partial<WebFilters>, scroll = false) {
    setFilters((current) => ({ ...current, ...next, page: next.page ?? 1 }));
    if (scroll) resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function reset() { setFilters({ ...emptyFilters }); setSearch(''); }
  function selectCategory(category: string) { setSearch(''); update({ category, query: '' }); }
  function submitSearch(event: FormEvent) { event.preventDefault(); update({ query: search.trim() }, true); }
  function mutateBag(transform: (current: BagItem[]) => BagItem[]) { const next = transform(bagRef.current); bagRef.current = next; setBag(next); }
  function add(product: NavigationProduct) { const result = addToBag(bagRef.current, product); mutateBag(() => result.bag); setToast(result.message); }
  function openDetail(product: NavigationProduct) { detailRequest.current++; setToast(''); setDetail(product); }
  function closeDetail() {
    detailRequest.current++; setDetail(null); setToast('');
    const params = new URLSearchParams(location.search); params.delete('part');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  }
  function openModal(next: Modal) { setToast(''); setModal(next); }
  async function copy(text: string, message = 'Скопировано') {
    try { await navigator.clipboard.writeText(text); setToast(message); }
    catch { setToast('Не удалось скопировать. Выделите текст и скопируйте вручную.'); }
  }
  const requestText = `Здравствуйте! Помогите проверить применяемость, цену и наличие:\n${bag.map((line) => `${line.product.code} — ${line.product.name}, ${line.quantity} шт.`).join('\n')}\nАвтомобиль / VIN: `;
  const draftText = encodeURIComponent(requestText).length <= 1500 ? requestText : `Здравствуйте! Нужна проверка подбора: ${bag.length} позиций. Пришлю список деталей. Автомобиль / VIN: `;
  function downloadSelection() {
    const url = URL.createObjectURL(new Blob([requestText], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'exeed-parts.txt'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="web-store">
    <a className="skip-link" href="#catalog">Перейти к деталям</a>
    <header className="site-header"><div className="container header-content">
      <a className="wordmark" href={location.pathname} aria-label="EXEED Friends — главная">EXEED<span>.</span><small>FRIENDS</small></a>
      <div className="header-actions">{historyList().length>0 && <button className="text-link" onClick={()=>openModal('orders')}>Мои заказы</button>}<button className="help-link" aria-label="Подбор по VIN" onClick={() => openModal('help')}><Icon name="shield" size={18}/><span>Подбор по VIN</span></button><button className="basket-button" onClick={() => openModal('cart')}><Icon name="cart" size={20}/><span>Корзина</span><b>{itemCount}</b></button></div>
    </div></header>

    <main className="container">
      <section className="page-intro" aria-labelledby="page-title"><div><h1 id="page-title">Каталог запчастей</h1><p>Выберите автомобиль и узел или найдите деталь по артикулу.</p></div>
        <form className="catalog-search" onSubmit={submitSearch}><label className="sr-only" htmlFor="parts-search">Артикул или название детали</label><Icon name="search" size={20}/><input id="parts-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Артикул или название" maxLength={200} autoComplete="off"/>{search && <button type="button" className="search-clear" onClick={() => { setSearch(''); update({ query: '' }); }} aria-label="Очистить поиск"><Icon name="close" size={16}/></button>}<button type="submit" className="search-submit" aria-label="Найти деталь"><Icon name="arrow" size={20}/></button></form>
      </section>

      <section className="workbench" aria-label="Подбор по автомобилю">
        <div className="vehicle-picker"><h2 className="step-title"><span>1</span>Автомобиль</h2>
          <label htmlFor="vehicle-brand">Марка</label><div className="select-wrap"><select id="vehicle-brand" aria-label="Марка автомобиля" value={filters.brand} disabled={!metadata} onChange={(event) => update({ brand: event.target.value, model: '' })}><option value="">{metadata ? 'Все марки' : 'Загружаем…'}</option>{metadata?.brands.map((brand) => <option key={brand.name} value={brand.name}>{brand.name}</option>)}</select><Icon name="down" size={16}/></div>
          <label htmlFor="vehicle-model">Модель</label><div className="select-wrap"><select id="vehicle-model" aria-label="Модель автомобиля" value={filters.model} disabled={!currentBrand?.models.length} onChange={(event) => update({ model: event.target.value })}><option value="">{currentBrand && !currentBrand.models.length ? 'Подбор по артикулу' : 'Все модели'}</option>{currentBrand?.models.map((model) => <option key={model}>{model}</option>)}</select><Icon name="down" size={16}/></div>
        </div>
        <div className="visual-picker"><div className="visual-heading"><h2 className="step-title"><span>2</span>Узел автомобиля</h2><span className="diagram-caption">Выберите на схеме</span></div><CarMap selected={filters.category ?? ''} onSelect={selectCategory}/>
          <nav className="categories" aria-label="Разделы каталога"><button className={!filters.category ? 'is-active' : ''} aria-pressed={!filters.category} onClick={() => selectCategory('')}>Все детали</button>{metadata?.categories.map((category) => <button key={category.id} className={filters.category === category.id ? 'is-active' : ''} onClick={() => selectCategory(category.id)} aria-pressed={filters.category === category.id}>{category.name}</button>)}</nav>
          <div className="select-wrap mobile-category"><select aria-label="Узел автомобиля" value={filters.category} onChange={(event) => selectCategory(event.target.value)}><option value="">Все узлы</option>{metadata?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><Icon name="down" size={16}/></div>
        </div>
      </section>

      <section className="catalog-section" id="catalog" ref={resultsRef} aria-labelledby="catalog-title">
        <div className="products-toolbar"><div><h2 id="catalog-title">{filters.query ? `Поиск: «${filters.query}»` : currentCategory?.name ?? 'Все детали'}<span className="result-count" aria-live="polite">{loading ? '…' : number(total)}</span></h2>{(filters.brand || filters.model) && <p className="selected-vehicle">{filters.brand} {filters.model}</p>}</div><div className="result-controls"><label className="stock-checkbox"><input type="checkbox" checked={Boolean(filters.inStock)} onChange={(event) => update({ inStock: event.target.checked })}/>В наличии</label><label className="sort-picker"><span className="sr-only">Сортировка деталей</span><select aria-label="Сортировка деталей" value={filters.sort} onChange={(event) => update({ sort: event.target.value })}><option value="name">По названию</option><option value="price-asc">Сначала дешевле</option><option value="price-desc">Сначала дороже</option></select><Icon name="down" size={14}/></label>{hasFilters && <button className="reset-button" onClick={reset}>Сбросить<Icon name="close" size={14}/></button>}</div></div>
        {currentCategory && <AssemblyMap category={currentCategory.id} title={currentCategory.name} query={filters.query ?? ''} onSelect={(query) => { setSearch(query); update({ query }); }}/>}
        {source === 'snapshot' && <p className="snapshot-notice">Каталог из выгрузки. Цену, наличие и совместимость уточним перед заказом.</p>}
        {error ? <div className="empty-state" role="alert"><Icon name="electric" size={28}/><h3>Каталог временно недоступен</h3><p>{error}</p><button className="button" onClick={() => setRetry((value) => value + 1)}>Попробовать снова</button></div> : loading ? <div className="product-loading" role="status" aria-label="Загрузка деталей"><span className="loading-dot"/>Ищем детали…</div> : !items.length ? <div className="empty-state"><Icon name="search" size={28}/><h3>Детали не найдены</h3><p>Попробуйте другой артикул или измените условия подбора.</p><button className="button button-secondary" onClick={reset}>Сбросить фильтры</button><a href={supportUrl} target="_blank" rel="noreferrer" className="text-link">Помощь менеджера<Icon name="arrow" size={15}/></a></div> : <>
          <div className="list-heading" aria-hidden="true"><span>Деталь / артикул</span><span>Наличие</span><span>Цена за шт.</span><span/></div>
          <div className="product-grid" aria-live="polite">{items.map((product) => {
            const available = product.stockQty >= product.packQty;
            const inBag = bag.some((line) => line.product.code === product.code);
            return <article className="product-card" key={product.id}><div className="product-title-group"><button className="product-name" onClick={() => openDetail(product)}>{product.name}</button><button className="article-code" onClick={() => void copy(product.code, 'Артикул скопирован')} aria-label={`Скопировать артикул ${product.code}`}>{product.code}<Icon name="copy" size={13}/></button>{product.packQty > 1 && <span className="pack-label">Партия {product.packQty} шт.</span>}</div><span className={`stock-label ${available ? '' : 'out-of-stock'}`} aria-label={available ? `В наличии ${product.stockQty} шт.` : 'Нет в наличии'}>{available ? `${number(product.stockQty)} шт.` : 'Нет в наличии'}</span><div className="product-price-row"><strong>{money(product.price)}</strong></div><button className={`add-button ${inBag ? 'in-bag' : ''}`} disabled={!available} onClick={() => add(product)} aria-label={`${inBag ? 'Добавить ещё' : 'Добавить в корзину'}: ${product.name}`}><Icon name={inBag ? 'check' : 'plus'} size={19}/></button></article>;
          })}</div>
          {total > 12 && <nav className="pagination" aria-label="Страницы каталога"><button disabled={filters.page === 1} onClick={() => update({ page: (filters.page ?? 1) - 1 }, true)} aria-label="Предыдущая страница"><Icon name="chevron" size={18} style={{ transform: 'rotate(180deg)' }}/></button><span>{filters.page} <span>из {Math.ceil(total / 12)}</span></span><button disabled={(filters.page ?? 1) * 12 >= total} onClick={() => update({ page: (filters.page ?? 1) + 1 }, true)} aria-label="Следующая страница"><Icon name="chevron" size={18}/></button></nav>}
        </>}
      </section>
    </main>

    <footer className="container site-footer"><span>© {new Date().getFullYear()} EXEED Friends</span><div><button onClick={() => openModal('delivery')}>Доставка и оплата</button><a href={supportUrl} target="_blank" rel="noreferrer">Связаться с нами<Icon name="arrow" size={14}/></a></div></footer>
    {toast && !modal && !detail && <div className="toast" role="status"><Icon name="check" size={17}/>{toast}</div>}

    {detail && <Dialog title="Деталь" feedback={toast} onClose={closeDetail}>
      {safeImageUrl(detail.imageUrl) && <img className="detail-image" src={safeImageUrl(detail.imageUrl)} alt={detail.name}/>}
      <button className="article-code detail-code" onClick={() => void copy(detail.code)} aria-label={`Скопировать артикул ${detail.code}`}>{detail.code}<Icon name="copy" size={15}/></button><h3 className="detail-name">{detail.name}</h3>
      {detail.vehicleApplications?.length ? <details className="catalog-applications"><summary>Марки и модели · {detail.vehicleApplications.length}</summary><p className="dialog-note">Перед заказом проверим исполнение по VIN.</p><ul>{detail.vehicleApplications.map((application) => <li key={`${application.brand}:${application.model}:${application.configuration}`}><div><strong>{application.brand} {application.model}</strong><span>{application.configuration}{application.modelYearFrom ? ` · модельный год ${application.modelYearFrom}+` : ''}</span></div></li>)}</ul></details> : detail.brands.length > 0 && <div className="detail-tags">{detail.brands.map((brand) => <span key={brand}>{brand}</span>)}{detail.models.map((model) => <span key={model}>{model.split(':')[1]}</span>)}</div>}
      {detail.description && <p className="dialog-note">{detail.description}</p>}
      <div className="detail-price"><strong>{money(detail.price)}</strong><span>за штуку{detail.packQty > 1 ? ` · партия ${detail.packQty} шт.` : ''}</span></div><p className="dialog-note">{detail.stockQty >= detail.packQty ? `Остаток по каталогу: ${detail.stockQty} шт.` : 'Нет в наличии'} Применяемость проверим по VIN. {source === 'snapshot' ? 'Цена из выгрузки, актуальность уточнит менеджер.' : 'Цена и наличие проверяются перед оформлением.'}</p>
      <button className="button full-width" disabled={detail.stockQty < detail.packQty} onClick={() => add(detail)}><Icon name="cart" size={19}/>Добавить в корзину</button><button className="button button-secondary full-width" onClick={() => { const params = new URLSearchParams(location.search); params.set('part', detail.code); void copy(`${location.origin}${location.pathname}?${params}`, 'Ссылка на деталь скопирована'); }}>Поделиться<Icon name="copy" size={16}/></button>
    </Dialog>}

    {modal === 'orders' && <Dialog title="Мои заказы" feedback="" onClose={()=>setModal(null)}><div className="checkout-form">{historyList().map(o=><button className="button button-secondary" key={o.number} onClick={()=>{setSelectedOrder(o.number);openModal('checkout');}}>Заказ W{o.number}</button>)}</div></Dialog>}
    {modal === 'checkout' && <Dialog title="Оформление заказа" feedback="" onClose={()=>{setModal(null);const u=new URL(location.href);u.searchParams.delete('webOrder');history.replaceState(null,'',u);}}><Checkout bag={bag} number={selectedOrder} onPlaced={()=>mutateBag(()=>[])}/></Dialog>}
    {modal === 'cart' && <Dialog title={`Корзина${itemCount ? ` · ${itemCount}` : ''}`} feedback={toast} onClose={() => setModal(null)}>{bag.length ? <>
      <div className="bag-lines">{bag.map(({ product, quantity }) => <div className="bag-line" key={product.code}><div className="bag-line-info"><small>{product.code}</small><strong>{product.name}</strong><div className="bag-line-controls"><div className="quantity-stepper"><button onClick={() => mutateBag((current) => changeBagQuantity(current, product.code, -1))} aria-label={`Уменьшить количество ${product.code}`}><Icon name="minus" size={15}/></button><span>{quantity}</span><button disabled={quantity + product.packQty > maxQuantity(product)} onClick={() => mutateBag((current) => changeBagQuantity(current, product.code, 1))} aria-label={`Увеличить количество ${product.code}`}><Icon name="plus" size={15}/></button></div><span>{money(Number(product.price) * quantity)}</span></div></div><button className="icon-button" aria-label={`Удалить ${product.code}`} onClick={() => mutateBag((current) => current.filter((line) => line.product.code !== product.code))}><Icon name="close" size={17}/></button></div>)}</div>
      <div className="bag-total"><span>Ориентировочно</span><strong>{money(subtotal)}</strong></div><p className="dialog-note">Стоимость и наличие проверим при оформлении.</p>
      {source==='live' && <button className="button full-width" onClick={()=>{setSelectedOrder(undefined);openModal('checkout');}}>Оформить на сайте</button>}
      {draftText !== requestText && <p className="dialog-note">Сохраните список кнопкой ниже и пришлите его менеджеру после перехода в Telegram.</p>}
      {requestText.length > 3500 ? <button className="button button-secondary full-width" onClick={downloadSelection}>Скачать список деталей</button> : <button className="button button-secondary full-width" onClick={() => void copy(requestText, 'Список деталей скопирован')}>Скопировать список<Icon name="copy" size={16}/></button>}
      <a className="button full-width" href={`${supportUrl}?text=${encodeURIComponent(draftText)}`} target="_blank" rel="noreferrer">Обсудить заказ в Telegram<Icon name="arrow" size={18}/></a>
    </> : <div className="empty-state"><Icon name="cart" size={34}/><h3>Корзина пока пуста</h3><p>Добавьте детали из каталога — сохраним их в этом браузере.</p><button className="button" onClick={() => { setModal(null); resultsRef.current?.scrollIntoView({ behavior: 'smooth' }); }}>В каталог</button></div>}</Dialog>}

    {modal === 'help' && <Dialog title="Подбор по VIN" feedback={toast} onClose={() => setModal(null)}><p className="dialog-lead">Отправьте VIN и название детали менеджеру. Учтём год, двигатель и комплектацию автомобиля.</p><p className="dialog-note">Схема помогает выбрать раздел каталога. Марка и модель в описании детали требуют проверки совместимости перед заказом.</p><a className="button full-width" href={supportUrl} target="_blank" rel="noreferrer">Написать менеджеру<Icon name="arrow" size={18}/></a></Dialog>}
    {modal === 'delivery' && <Dialog title="Доставка и оплата" feedback={toast} onClose={() => setModal(null)}><div className="info-block"><h3>Самовывоз</h3><p>Москва, Новоивановское, вл. 110. Время получения согласуйте с менеджером.</p></div><div className="info-block"><h3>Доставка</h3><p>СДЭК и Яндекс Доставка. Стоимость и срок уточним по адресу и составу заказа до оплаты.</p></div><div className="info-block"><h3>Оплата</h3><p>Платёжная ссылка или счёт для юридического лица — после подтверждения деталей, цены и наличия.</p></div><a className="button full-width" href={supportUrl} target="_blank" rel="noreferrer">Уточнить условия<Icon name="arrow" size={18}/></a></Dialog>}
  </div>;
}
