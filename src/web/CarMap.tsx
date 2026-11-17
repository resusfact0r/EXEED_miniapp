const nodes = [
  { id: 'engine', number: '1', name: 'Двигатель', x: 700, y: 34 },
  { id: 'body', number: '2', name: 'Кузов и оптика', x: 850, y: 200 },
  { id: 'suspension', number: '3', name: 'Подвеска и рулевое', x: 650, y: 326 },
  { id: 'brakes', number: '4', name: 'Тормозная система', x: 260, y: 326 },
  { id: 'interior', number: '5', name: 'Салон и аксессуары', x: 450, y: 34 },
  { id: 'transmission', number: '6', name: 'Трансмиссия', x: 450, y: 326 },
];

export function CarMap({ selected, onSelect }: { selected: string; onSelect: (category: string) => void }) {
  return <div className="car-map" aria-label="Выбор узла на схеме автомобиля">
    <div className="car-map-canvas">
      <img className="vehicle" src={`${import.meta.env.BASE_URL}car-side.svg`} alt="Условная схема автомобиля сбоку: два колеса одинакового размера на одной оси, передняя часть справа" width="900" height="360" draggable="false"/>
      <svg className="map-connectors" viewBox="0 0 900 360" aria-hidden="true">
        <path d="M700 34V145M850 200H800L758 180M650 326V283M260 326V283M450 34V98M450 326V232"/>
      </svg>
      {nodes.map((node) => <button key={node.id} className={`map-pin ${selected === node.id ? 'is-active' : ''}`} style={{ left: `${node.x / 9}%`, top: `${node.y / 3.6}%` }} onClick={() => onSelect(selected === node.id ? '' : node.id)} aria-label={`Показать раздел: ${node.name}`} aria-pressed={selected === node.id}><span>{node.number}</span><span className="pin-tooltip">{node.name}</span></button>)}
    </div>
  </div>;
}
