import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CarMap } from './CarMap';
import { AssemblyMap } from './AssemblyMap';
import { Icon } from './Icons';
import { botUrl, findProduct, findProducts, loadCatalog, money, supportUrl, type CatalogMetadata, type NavigationProduct, type WebFilters } from './catalog';
import './web.css';

type BagItem = { product: NavigationProduct; quantity: number };
type Modal = 'cart' | 'help' | 'delivery' | 'account' | null;
const storageKey = 'exeed-friends:web-bag:v1';
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
const maxQuantity = (product: NavigationProduct) => product.packQty > 1 ? (product.stockQty >= product.packQty ? product.packQty : 0) : Math.min(10, product.stockQty);

function initialFilters(): WebFilters {
  const params = new URLSearchParams(location.search);
  return { brand: params.get('brand') ?? '', model: params.get('model') ?? '', category: params.get('category') ?? '', query: params.get('q') ?? '', page: 1, pageSize: 12, sort: 'name', inStock: false };
}

function readBag(): BagItem[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is BagItem => item && typeof item.product?.code === 'string' && typeof item.product?.name === 'string' && Number.isFinite(Number(item.product?.price)) && Number.isInteger(item.product?.packQty) && item.product.packQty > 0 && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= maxQuantity(item.product) && item.quantity % item.product.packQty === 0 && Array.isArray(item.product.categories) && item.product.categories.every((category: unknown) => typeof category === 'string')).slice(0, 100);
  } catch { return []; }
}

function Dialog({ title, children, onClose, feedback = '' }: { title: string; children: ReactNode; onClose: () => void; feedback?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="web-dialog" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="dialog-title">
    <div className="dialog-body"><div className="dialog-header"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Закрыть окно"><Icon name="close"/></button></div>{children}{feedback && <div className="dialog-feedback" role="status">{feedback}</div>}</div>
  </dialog>;
}

function BrandMark({ name }: { name: string }) {
  if (name === 'CHERY') return <span className="brand-emblem chery-emblem"><svg viewBox="0 0 64 40" aria-hidden="true"><ellipse cx="32" cy="23" rx="26" ry="12"/><path d="m14 29 18-25 18 25M25 20h14"/></svg></span>;
  if (name === 'OMODA') return <span className="brand-emblem word-emblem omoda-emblem">O M O D A</span>;
  if (name === 'EXEED') return <span className="brand-emblem word-emblem">E X E E D</span>;
  return <span className="brand-emblem word-emblem">{name}</span>;
}

export function WebApp() {
  const [metadata, setMetadata] = useState<CatalogMetadata>();
  const [source, setSource] = useState<'live' | 'snapshot'>('live');
  const [sourceDate, setSourceDate] = useState<string | null>(null);
  const [filters, setFilters] = useState<WebFilters>(initialFilters);
  const [search, setSearch] = useState(filters.query ?? '');
  const [items, setItems] = useState<NavigationProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [bag, setBag] = useState<BagItem[]>(readBag);
  const [modal, setModal] = useState<Modal>(null);
  const [detail, setDetail] = useState<NavigationProduct | null>(null);
  const [toast, setToast] = useState('');
  const [showBrands, setShowBrands] = useState(false);
  const resultsRef = useRef<HTMLElement>(null);
  const itemCount = bag.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = bag.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
  const currentBrand = metadata?.brands.find((brand) => brand.name === filters.brand);
  const currentCategory = metadata?.categories.find((category) => category.id === filters.category);
  const hasFilters = Boolean(filters.brand || filters.model || filters.category || filters.query || filters.inStock);

  useEffect(() => {
    let active = true;
    setError(''); setLoading(true);
    loadCatalog().then((data) => {
      if (!active) return;
      setMetadata(data.metadata); setSource(data.source); setSourceDate(data.sourceDate);
    }).catch((reason: Error) => { if (active) { setError(reason.message); setLoading(false); } });
    return () => { active = false; };
  }, [retry]);

  useEffect(() => {
    if (!metadata) return;
    let active = true;
    setLoading(true); setError('');
    findProducts(filters).then((result) => { if (active) { setItems(result.items); setTotal(result.total); } }).catch(() => { if (active) setError('Не удалось получить детали. Проверьте соединение и попробуйте ещё раз.'); }).finally(() => { if (active) setLoading(false); });
    const params = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries({ brand: filters.brand, model: filters.model, category: filters.category, q: filters.query })) {
      if (value) params.set(key, value); else params.delete(key);
    }
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    return () => { active = false; };
  }, [metadata, filters, retry]);

  useEffect(() => {
    if (!metadata) return;
    const code = new URLSearchParams(location.search).get('part');
    if (code) void findProduct(code).then(setDetail).catch(() => setToast('Деталь по этой ссылке не найдена'));
  }, [metadata]);

  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(bag)); } catch { /* A full or disabled store must not prevent browsing. */ } }, [bag]);
  useEffect(() => { if (toast) { const timer = window.setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); } }, [toast]);

  function update(next: Partial<WebFilters>, scroll = false) {
    setFilters((current) => ({ ...current, ...next, page: next.page ?? 1 }));
    if (scroll) resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function submitSearch(event: FormEvent) { event.preventDefault(); update({ query: search.trim() }, true); }
  function reset() { setFilters({ ...initialFilters(), brand: '', model: '', category: '', query: '', inStock: false, page: 1 }); setSearch(''); }
  function selectCategory(category: string, scroll = false) { setSearch(''); update({ category, query: '' }, scroll); }

  function add(product: NavigationProduct) {
    const limit = maxQuantity(product);
    if (!limit) return;
    const existing = bag.find((item) => item.product.code === product.code);
    if (!existing && bag.length >= 100) { setToast('В корзине можно сохранить до 100 разных деталей'); return; }
    if (existing && existing.quantity + product.packQty > limit) { setToast('Достигнут лимит количества для этой детали'); return; }
    setBag((current) => {
      const line = current.find((item) => item.product.code === product.code);
      return line ? current.map((item) => item.product.code === product.code ? { product, quantity: Math.min(limit, item.quantity + product.packQty) } : item) : [...current, { product, quantity: product.packQty }];
    });
    setToast('Деталь добавлена в корзину');
  }

  function changeQuantity(code: string, step: number) {
    setBag((current) => current.map((item) => item.product.code === code ? { ...item, quantity: Math.min(maxQuantity(item.product), item.quantity + step * item.product.packQty) } : item).filter((item) => item.quantity > 0));
  }

  async function copy(text: string, message = 'Скопировано') {
    try { await navigator.clipboard.writeText(text); setToast(message); } catch { setToast('Не удалось скопировать. Можно выделить артикул вручную.'); }
  }

  const requestText = `Здравствуйте! Помогите проверить применяемость, цену и наличие:\n${bag.map((item) => `${item.product.code} — ${item.product.name}, ${item.quantity} шт.`).join('\n')}\nАвтомобиль / VIN: `;

  return <div className="web-store">
    <div className="utility-bar"><div className="container utility-content"><span><Icon name="pin" size={13}/> Москва <span className="utility-divider">/</span> Доставляем по России</span><a href={supportUrl} target="_blank" rel="noreferrer">Поможем с подбором <Icon name="arrow" size={13}/></a></div></div>
    <header className="site-header"><div className="container header-content">
      <a href={location.pathname} className="wordmark" aria-label="EXEED Friends — главная"><span>EXEED<span className="wordmark-dot">.</span></span><small>FRIENDS / AUTO PARTS</small></a>
      <nav className="desktop-nav" aria-label="Основная навигация"><button className="nav-active" onClick={() => resultsRef.current?.scrollIntoView({ behavior: 'smooth' })}>Каталог запчастей</button><button onClick={() => setModal('help')}>Как подобрать</button><button onClick={() => setModal('delivery')}>Доставка и оплата</button></nav>
      <div className="header-actions"><button className="account-button" onClick={() => setModal('account')} aria-label="Открыть информацию о личном кабинете"><Icon name="car"/><span>Мой гараж</span></button><button className="basket-button" onClick={() => setModal('cart')}><Icon name="cart" size={20}/><span>Корзина</span><b>{itemCount}</b></button></div>
    </div></header>

    <main className="container">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy"><div className="eyebrow"><span/> КИТАЙСКИЙ АВТОМОБИЛЬ. ПОНЯТНЫЙ ПОДБОР.</div><h1 id="hero-title">Нужная деталь.<br/><span>На своём месте.</span></h1><p>Найдите запчасть по артикулу или просто<br className="desktop-break"/> выберите нужный узел на схеме автомобиля.</p>
          <form className="hero-search" onSubmit={submitSearch}><Icon name="search" size={21}/><label className="sr-only" htmlFor="parts-search">Артикул или название детали</label><input id="parts-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Артикул или название детали" maxLength={200}/><button type="submit" aria-label="Найти деталь"><Icon name="arrow" size={23}/></button></form>
          <div className="search-hints">Например: {['масляный фильтр', '501014147AA'].map((text) => <button key={text} onClick={() => { setSearch(text); update({ query: text }, true); }}>{text}</button>)}</div>
          <div className="hero-caption"><Icon name="check" size={14}/> Без регистрации <span/> Поиск по всему каталогу</div>
        </div>
        <CarMap selected={filters.category ?? ''} onSelect={(category) => selectCategory(category, true)}/>
      </section>

      <section className="brand-section" aria-labelledby="brands-title"><div className="section-mini-heading"><h2 id="brands-title">Начните с марки автомобиля</h2><span>{metadata ? `${metadata.brands.length} марок в каталоге` : 'Загружаем марки…'}</span></div>
        <div className="brands-grid">{(showBrands ? metadata?.brands : metadata?.brands.slice(0, 5))?.map((brand) => <button className={`brand-card ${filters.brand === brand.name ? 'is-selected' : ''}`} key={brand.name} aria-pressed={filters.brand === brand.name} onClick={() => update({ brand: filters.brand === brand.name ? '' : brand.name, model: '' })}><BrandMark name={brand.name}/><span className="brand-card-bottom"><span>{brand.name} <small>{number(brand.count)} позиций</small></span><Icon name={filters.brand === brand.name ? 'check' : 'arrow'} size={18}/></span></button>)}
          {!metadata && !error && Array.from({ length: 4 }, (_, i) => <div key={i} className="brand-card skeleton"/>)}
          {metadata && metadata.brands.length > 5 && <button className="brand-card all-brands" onClick={() => setShowBrands(!showBrands)} aria-expanded={showBrands}><span className="brand-emblem"><Icon name={showBrands ? 'minus' : 'plus'} size={30}/></span><span className="brand-card-bottom"><span>{showBrands ? 'Свернуть' : 'Все марки'}<small>{showBrands ? 'Основные марки' : `${metadata.brands.length} марок автомобилей`}</small></span><Icon name="arrow" size={18}/></span></button>}
        </div>
        {metadata && metadata.unclassified > 0 && <p className="unclassified-note">У {number(metadata.unclassified)} деталей марка не указана в описании. Они доступны в <button onClick={() => { reset(); resultsRef.current?.scrollIntoView({ behavior: 'smooth' }); }}>общем каталоге</button> и поиске по артикулу.</p>}
      </section>

      <section className="catalog-section" id="catalog" ref={resultsRef} aria-labelledby="catalog-title">
        <div className="catalog-heading"><div><div className="eyebrow">КАТАЛОГ / ПОДБОР ПО УЗЛАМ</div><h2 id="catalog-title">Что нужно вашему авто<span className="accent">?</span></h2></div><span className="catalog-total">{metadata ? number(metadata.total) : '…'} <span>деталей в каталоге</span></span></div>
        <div className="vehicle-picker"><div className="vehicle-picker-label"><Icon name="car" size={25}/><span>Ваш автомобиль<small>Уточните подбор</small></span></div><label><span>МАРКА</span><select aria-label="Марка автомобиля" value={filters.brand} onChange={(event) => update({ brand: event.target.value, model: '' })}><option value="">Все марки</option>{metadata?.brands.map((brand) => <option key={brand.name}>{brand.name}</option>)}</select><Icon name="down" size={15}/></label><label><span>МОДЕЛЬ</span><select aria-label="Модель автомобиля" value={filters.model} disabled={!currentBrand || currentBrand.models.length === 0} onChange={(event) => update({ model: event.target.value })}><option value="">{currentBrand && !currentBrand.models.length ? 'Подбор по артикулу' : 'Все модели'}</option>{currentBrand?.models.map((model) => <option key={model}>{model}</option>)}</select><Icon name="down" size={15}/></label><button className="button vehicle-picker-action" onClick={() => setModal('help')}>Помочь с подбором<Icon name="arrow" size={17}/></button></div>
        <p className="fitment-note"><Icon name="shield" size={14}/> Марки и модели определены по описанию деталей. Перед заказом уточните применяемость по VIN.</p>

        <div className="catalog-layout"><aside className="categories" aria-label="Разделы каталога"><div className="categories-heading">Узлы автомобиля <span>08</span></div><button className={!filters.category ? 'is-active' : ''} onClick={() => selectCategory('')}><Icon name="car"/><span>Все запчасти</span><Icon name="chevron" size={14}/></button>{metadata?.categories.map((category) => <button key={category.id} className={filters.category === category.id ? 'is-active' : ''} onClick={() => selectCategory(category.id)} aria-pressed={filters.category === category.id}><Icon name={category.id}/><span>{category.name}</span><Icon name="chevron" size={14}/></button>)}<div className="sidebar-help"><Icon name="message" size={25}/><strong>Не уверены в детали?</strong><p>Отправьте VIN менеджеру.<br/>Поможем разобраться.</p><a href={supportUrl} target="_blank" rel="noreferrer">Написать в Telegram <Icon name="arrow" size={15}/></a></div></aside>

          <div className="products-area">
            {currentCategory && <AssemblyMap category={currentCategory.id} title={currentCategory.name} query={filters.query ?? ''} onSelect={(query) => { setSearch(query); update({ query }); }}/> }
            <div className="products-toolbar"><div><h3>{filters.query ? `Поиск: «${filters.query}»` : currentCategory?.name ?? 'Все запчасти'}</h3><span>{loading ? 'Ищем детали…' : `${number(total)} позиций`}{filters.brand ? ` · ${filters.brand}` : ''}{filters.model ? ` ${filters.model}` : ''}</span></div><label className="sort-picker"><span className="sr-only">Сортировка деталей</span><select value={filters.sort} onChange={(event) => update({ sort: event.target.value })}><option value="name">По названию</option><option value="price-asc">Сначала дешевле</option><option value="price-desc">Сначала дороже</option></select><Icon name="down" size={14}/></label></div>
            <div className="filter-row"><label className="stock-checkbox"><input type="checkbox" checked={Boolean(filters.inStock)} onChange={(event) => update({ inStock: event.target.checked })}/><span>Только в наличии</span></label>{hasFilters && <button className="reset-button" onClick={reset}>Сбросить фильтры<Icon name="close" size={13}/></button>}</div>
            {source === 'snapshot' && <div className="snapshot-notice"><i/><span>Каталог из выгрузки{sourceDate ? ` от ${new Date(sourceDate).toLocaleDateString('ru-RU')}` : ''}. Цены и остатки уточняются при заказе.</span></div>}
            {error ? <div className="empty-state" role="alert"><Icon name="electric" size={38}/><h3>Каталог временно недоступен</h3><p>{error}</p><button className="button" onClick={() => setRetry((value) => value + 1)}>Попробовать снова</button></div> : loading ? <div className="product-grid" aria-busy="true" aria-label="Загрузка деталей">{Array.from({ length: 6 }, (_, i) => <div className="product-card product-skeleton" key={i}><div className="skeleton"/><div className="skeleton"/><div className="skeleton"/></div>)}</div> : items.length === 0 ? <div className="empty-state"><Icon name="search" size={38}/><h3>Попробуем подобрать иначе</h3><p>По выбранным условиям деталей нет. Измените фильтры или отправьте VIN менеджеру.</p><div><button className="button" onClick={reset}>Сбросить фильтры</button><a className="text-link" href={supportUrl} target="_blank" rel="noreferrer">Помощь с подбором <Icon name="arrow" size={15}/></a></div></div> : <>
              <div className="product-grid" aria-live="polite">{items.map((product) => {
                const category = product.categories[0] ?? 'engine';
                const inBag = bag.some((item) => item.product.code === product.code);
                const available = product.stockQty >= product.packQty;
                return <article className="product-card" key={product.id}><button className="product-visual" onClick={() => setDetail(product)} aria-label={`Подробнее: ${product.name}`}><span className="product-type">{product.brands[0] ?? 'КАТАЛОГ'}</span>{product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading="lazy"/> : <div className={`part-drawing part-${category}`}><Icon name={category} size={76}/><span>СХЕМА РАЗДЕЛА</span></div>}<span className="product-open"><Icon name="plus" size={17}/></span></button><div className="product-info"><button className="article-code" onClick={() => void copy(product.code, 'Артикул скопирован')}>{product.code}<Icon name="copy" size={12}/></button><button className="product-name" onClick={() => setDetail(product)}>{product.name}</button><span className={`stock-label ${available ? '' : 'out-of-stock'}`}><i/>{available ? `${source === 'snapshot' ? 'По выгрузке: ' : 'В наличии: '}${number(product.stockQty)} шт.` : 'Нет в наличии'}</span><div className="product-price-row"><div><strong>{money(product.price)}</strong><small>{product.packQty > 1 ? `за шт. · партия ${product.packQty} шт.` : source === 'snapshot' ? 'ориентировочно' : 'за 1 шт.'}</small></div><button className={`add-button ${inBag ? 'in-bag' : ''}`} disabled={!available} onClick={() => add(product)} aria-label={`${inBag ? 'Добавить ещё' : 'Добавить в корзину'}: ${product.name}`}><Icon name={inBag ? 'check' : 'cart'} size={19}/></button></div></div></article>;
              })}</div>
              {total > 12 && <nav className="pagination" aria-label="Страницы каталога"><button disabled={filters.page === 1} onClick={() => update({ page: (filters.page ?? 1) - 1 }, true)} aria-label="Предыдущая страница"><Icon name="chevron" style={{ transform: 'rotate(180deg)' }} size={17}/></button><span>Страница <b>{filters.page}</b> из {Math.ceil(total / 12)}</span><button disabled={(filters.page ?? 1) * 12 >= total} onClick={() => update({ page: (filters.page ?? 1) + 1 }, true)} aria-label="Следующая страница"><Icon name="chevron" size={17}/></button></nav>}
            </>}
          </div>
        </div>
      </section>

      <section className="service-strip" aria-label="Сервис"><div><span className="service-icon"><Icon name="shield" size={25}/></span><span><strong>Подберём по VIN</strong><small>Уточним совместимость перед заказом</small></span></div><div><span className="service-icon"><Icon name="truck" size={26}/></span><span><strong>Доставим по России</strong><small>СДЭК, Яндекс Доставка или самовывоз</small></span></div><div><span className="service-icon"><Icon name="message" size={25}/></span><span><strong>Всегда на связи</strong><small>Поможем от подбора до получения</small></span></div></section>
      <section className="help-banner"><div><div className="eyebrow">ЧЕЛОВЕК РАЗБЕРЁТСЯ</div><h2>Не знаете артикул?<br/>Мы знаем, как помочь.</h2><p>Пришлите VIN автомобиля и название детали.<br/>Остальное подберём вместе.</p></div><a className="button" href={supportUrl} target="_blank" rel="noreferrer">Написать менеджеру<Icon name="arrow" size={19}/></a><span className="banner-decoration" aria-hidden="true">↗</span></section>
    </main>

    <footer className="site-footer"><div className="container footer-main"><a href={location.pathname} className="wordmark"><span>EXEED<span className="wordmark-dot">.</span></span><small>FRIENDS / AUTO PARTS</small></a><p>Детали для вашего автомобиля.<br/>Внимание к каждой детали.</p><div><a href={supportUrl} target="_blank" rel="noreferrer">Связаться с нами <Icon name="arrow" size={14}/></a><a href={botUrl} target="_blank" rel="noreferrer">Открыть Mini App <Icon name="arrow" size={14}/></a></div></div><div className="container footer-bottom"><span>© {new Date().getFullYear()} EXEED Friends</span><span>Цены носят справочный характер. Применяемость уточняйте перед заказом.</span><a href="#hero-title" aria-label="Наверх">Наверх ↑</a></div></footer>
    <div className="mobile-bottom"><button onClick={() => resultsRef.current?.scrollIntoView({ behavior: 'smooth' })}><Icon name="search" size={20}/>Каталог</button><button onClick={() => setModal('help')}><Icon name="message" size={20}/>Подбор</button><button onClick={() => setModal('cart')}><Icon name="cart" size={20}/>Корзина{itemCount > 0 && <b>{itemCount}</b>}</button></div>
    {toast && <div className="toast" role="status"><Icon name="check" size={17}/>{toast}</div>}

    {detail && <Dialog feedback={toast} title="Карточка детали" onClose={() => setDetail(null)}><div className="detail-visual"><Icon name={detail.categories[0] ?? 'engine'} size={100}/><span>Изображение раздела</span></div><div className="detail-code">АРТИКУЛ <button className="article-code" onClick={() => void copy(detail.code)}>{detail.code}<Icon name="copy" size={14}/></button></div><h3 className="detail-name">{detail.name}</h3><div className="detail-tags">{detail.brands.map((brand) => <span key={brand}>{brand}</span>)}{detail.models.map((model) => <span key={model}>{model.split(':')[1]}</span>)}</div>{detail.description && <p>{detail.description}</p>}<p className="dialog-note">Применяемость определяется по VIN. {source === 'snapshot' ? 'Цена и остаток из выгрузки, актуальность уточнит менеджер.' : 'Цена и наличие проверяются перед оформлением заказа.'}</p><div className="detail-price"><strong>{money(detail.price)}</strong><span>за штуку · {detail.stockQty} шт. по каталогу{detail.packQty > 1 ? ` · партия ${detail.packQty} шт.` : ''}</span></div><button className="button full-width" disabled={detail.stockQty < detail.packQty} onClick={() => add(detail)}><Icon name="cart" size={19}/>Добавить в корзину</button><button className="button button-secondary full-width" onClick={() => { const params = new URLSearchParams(location.search); params.set('part', detail.code); void copy(`${location.origin}${location.pathname}?${params}`, 'Ссылка на деталь скопирована'); }}>Поделиться деталью<Icon name="copy" size={16}/></button></Dialog>}

    {modal === 'cart' && <Dialog feedback={toast} title={`Корзина${itemCount ? ` · ${itemCount}` : ''}`} onClose={() => setModal(null)}>{bag.length ? <><p className="dialog-note">Сохраните подборку и отправьте менеджеру для проверки применяемости, цены и наличия.</p><div className="bag-lines">{bag.map(({ product, quantity }) => <div className="bag-line" key={product.code}><div className="bag-icon"><Icon name={product.categories[0] ?? 'engine'} size={30}/></div><div className="bag-line-info"><small>{product.code}</small><strong>{product.name}</strong><div className="bag-line-controls"><div className="quantity-stepper"><button onClick={() => changeQuantity(product.code, -1)} aria-label={`Уменьшить количество ${product.code}`}><Icon name="minus" size={14}/></button><span>{quantity}</span><button disabled={quantity + product.packQty > maxQuantity(product)} onClick={() => changeQuantity(product.code, 1)} aria-label={`Увеличить количество ${product.code}`}><Icon name="plus" size={14}/></button></div><span>{money(Number(product.price) * quantity)}</span></div></div><button className="icon-button" aria-label={`Удалить ${product.code}`} onClick={() => setBag((current) => current.filter((item) => item.product.code !== product.code))}><Icon name="close" size={16}/></button></div>)}</div><div className="bag-total"><span>Ориентировочно</span><strong>{money(subtotal)}</strong></div><p className="dialog-note">Доставка рассчитывается отдельно. Отправка списка менеджеру не создаёт и не оплачивает заказ.</p><button className="button button-secondary full-width" onClick={() => void copy(requestText, 'Список деталей скопирован')}>Скопировать список<Icon name="copy" size={16}/></button><a className="button full-width" href={`${supportUrl}?text=${encodeURIComponent(requestText)}`} target="_blank" rel="noreferrer">Обсудить заказ в Telegram<Icon name="arrow" size={18}/></a></> : <div className="empty-state"><Icon name="cart" size={42}/><h3>Здесь будут ваши детали</h3><p>Добавьте их из каталога — сохраним подборку в этом браузере.</p><button className="button" onClick={() => { setModal(null); resultsRef.current?.scrollIntoView({ behavior: 'smooth' }); }}>Перейти в каталог</button></div>}</Dialog>}

    {modal === 'help' && <Dialog feedback={toast} title="Поможем найти свою деталь" onClose={() => setModal(null)}><div className="help-steps"><div><b>01</b><span><strong>Выберите марку и модель</strong><p>Покажем детали, в описании которых указан ваш автомобиль.</p></span></div><div><b>02</b><span><strong>Нажмите на узел автомобиля</strong><p>Схема ведёт в раздел каталога. Деталь можно найти и по названию или артикулу.</p></span></div><div><b>03</b><span><strong>Уточните применяемость по VIN</strong><p>У одной модели могут отличаться двигатель, год и комплектация. Менеджер поможет проверить выбор.</p></span></div></div><a className="button full-width" href={supportUrl} target="_blank" rel="noreferrer">Отправить VIN менеджеру<Icon name="arrow" size={17}/></a></Dialog>}

    {modal === 'delivery' && <Dialog feedback={toast} title="Доставка и оплата" onClose={() => setModal(null)}><div className="info-block"><Icon name="pin" size={24}/><div><h3>Самовывоз</h3><p>Москва, Новоивановское, вл. 110. Время получения согласуйте с менеджером.</p></div></div><div className="info-block"><Icon name="truck" size={24}/><div><h3>Доставка по России</h3><p>СДЭК и Яндекс Доставка. Стоимость и срок зависят от адреса, веса и габаритов заказа — уточним до оплаты.</p></div></div><div className="info-block"><Icon name="shield" size={24}/><div><h3>Оплата после подтверждения</h3><p>По платёжной ссылке или счёту для юридических лиц. Сначала проверим детали, цену и наличие.</p></div></div><a className="button full-width" href={supportUrl} target="_blank" rel="noreferrer">Уточнить условия<Icon name="arrow" size={17}/></a></Dialog>}

    {modal === 'account' && <Dialog feedback={toast} title="Ваш автомобиль и заказы" onClose={() => setModal(null)}><div className="empty-state"><Icon name="car" size={48}/><h3>{filters.brand ? `${filters.brand} ${filters.model ?? ''}` : 'Выберите свой автомобиль'}</h3><p>Выбор марки и модели доступен в каталоге. История заказов и оформление через личный кабинет доступны в Telegram Mini App.</p><a className="button" href={botUrl} target="_blank" rel="noreferrer">Открыть Telegram Mini App<Icon name="arrow" size={17}/></a></div></Dialog>}
  </div>;
}
