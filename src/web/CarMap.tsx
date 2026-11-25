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

type CarMapProps = { selected: string; onSelect: (category: string) => void };

export function CarMap(props: CarMapProps) {
  const [showOrbit, setShowOrbit] = useState(false);

  return <>
    <div className="visual-heading">
      <h2 className="step-title"><span>2</span>Узел автомобиля</h2>
      <div className="car-view-controls" role="group" aria-label="Вид автомобиля">
        <button type="button" aria-pressed={!showOrbit} onClick={() => setShowOrbit(false)}>Сбоку</button>
        <button type="button" aria-pressed={showOrbit} onClick={() => setShowOrbit(true)}>3D</button>
      </div>
    </div>
    <div className="car-map" aria-label="Схема автомобиля">
      {showOrbit ? (
        <ErrorBoundary fallback={<>
          <p className="car-orbit-status" role="status">Не удалось загрузить 3D. Боковая схема доступна.</p>
          <SideMap {...props}/>
        </>}>
          <Suspense fallback={<p className="car-orbit-status" role="status">Загружаем 3D…</p>}>
            <CarOrbit/>
          </Suspense>
        </ErrorBoundary>
      ) : <SideMap {...props}/>}
    </div>
  </>;
}

function SideMap({ selected, onSelect }: CarMapProps) {
  return <div className="car-map-canvas">
    <img className="vehicle" src={`${import.meta.env.BASE_URL}car-side.svg`} alt="Условная схема автомобиля сбоку: два колеса одинакового размера на одной оси, передняя часть справа" width="900" height="360" draggable="false"/>
    <svg className="map-connectors" viewBox="0 0 900 360" aria-hidden="true">
      <path d="M700 34V145M850 200H800L758 180M650 326V283M260 326V283M450 34V98M450 326V232"/>
    </svg>
    {nodes.map((node) => <button key={node.id} className={`map-pin ${selected === node.id ? 'is-active' : ''}`} style={{ left: `${node.x / 9}%`, top: `${node.y / 3.6}%` }} onClick={() => onSelect(selected === node.id ? '' : node.id)} aria-label={`Показать раздел: ${node.name}`} aria-pressed={selected === node.id}><span>{node.number}</span><span className="pin-tooltip">{node.name}</span></button>)}
  </div>;
}
