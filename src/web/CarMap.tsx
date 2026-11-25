import { lazy, Suspense, useState } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';

const CarOrbit = lazy(() => import('./CarOrbit').then(({ CarOrbit }) => ({ default: CarOrbit })));

const nodes = [
  { id: 'engine', number: '1', name: 'Двигатель', x: 700, y: 34 },
  { id: 'body', number: '2', name: 'Кузов и оптика', x: 850, y: 200 },
  { id: 'suspension', number: '3', name: 'Подвеска и рулевое', x: 650, y: 326 },
  { id: 'brakes', number: '4', name: 'Тормозная система', x: 260, y: 326 },
  { id: 'interior', number: '5', name: 'Салон и аксессуары', x: 450, y: 34 },
  { id: 'transmission', number: '6', name: 'Трансмиссия', x: 450, y: 326 },
];

type CarMapProps = { selected: string[]; onSelect: (category: string) => void };

export function CarMap(props: CarMapProps) {
  const [showOrbit, setShowOrbit] = useState(() => new URLSearchParams(location.search).get('view') === '3d');

  function switchView(orbit: boolean) {
    setShowOrbit(orbit);
    const url = new URL(location.href);
    if (orbit) url.searchParams.set('view', '3d'); else url.searchParams.delete('view');
    history.replaceState(null, '', url);
  }

  return <>
    <div className="visual-heading">
      <h2 className="step-title"><span>2</span>Узел автомобиля</h2>
      <div className="car-view-controls" role="group" aria-label="Вид автомобиля">
        <button type="button" aria-pressed={!showOrbit} onClick={() => switchView(false)}>Сбоку</button>
        <button type="button" aria-pressed={showOrbit} onClick={() => switchView(true)}>3D</button>
      </div>
    </div>
    <div className="car-map" aria-label="Схема автомобиля">
      {showOrbit ? (
        <ErrorBoundary fallback={<>
          <p className="car-orbit-status" role="status">Не удалось загрузить 3D. Боковая схема доступна.</p>
          <SideMap {...props}/>
        </>}>
          <Suspense fallback={<p className="car-orbit-status" role="status">Загружаем 3D…</p>}>
            <CarOrbit selected={props.selected}/>
          </Suspense>
        </ErrorBoundary>
      ) : <SideMap {...props}/>}
    </div>
    <p className="part-instruction">Выберите один или несколько узлов для подсветки.</p>
  </>;
}

function SideMap({ selected, onSelect }: CarMapProps) {
  const poster = <img className="vehicle" src={`${import.meta.env.BASE_URL}car-profile.webp`} alt="Автомобиль сбоку, передняя часть справа" width="900" height="360" draggable="false"/>;
  return <div className="car-map-canvas">
    {selected.length ? <ErrorBoundary fallback={poster}><Suspense fallback={poster}><CarOrbit profile selected={selected}/></Suspense></ErrorBoundary> : poster}
    <svg className="map-connectors" viewBox="0 0 900 360" aria-hidden="true">
      <path d="M700 34V118L665 162M850 200H800L760 183M650 326V279M260 326V279M450 34V88M450 326V247"/>
    </svg>
    {nodes.map((node) => <button key={node.id} className={`map-pin ${selected.includes(node.id) ? 'is-active' : ''}`} style={{ left: `${node.x / 9}%`, top: `${node.y / 3.6}%` }} onClick={() => onSelect(node.id)} aria-label={`Показать раздел: ${node.name}`} aria-pressed={selected.includes(node.id)}><span>{node.number}</span><span className="pin-tooltip">{node.name}</span></button>)}
  </div>;
}
