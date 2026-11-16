import { Icon } from './Icons';

const pins = [
  { id: 'engine', number: '01', name: 'Двигатель', x: 69, y: 47 },
  { id: 'body', number: '02', name: 'Кузов и оптика', x: 86, y: 59 },
  { id: 'suspension', number: '03', name: 'Подвеска', x: 64, y: 72 },
  { id: 'brakes', number: '04', name: 'Тормоза', x: 25, y: 68 },
  { id: 'interior', number: '05', name: 'Салон', x: 45, y: 32 },
  { id: 'transmission', number: '06', name: 'Трансмиссия', x: 45, y: 59 },
];

export function CarMap({ selected, onSelect }: { selected: string; onSelect: (category: string) => void }) {
  return <div className="car-map">
    <div className="map-topline"><span><i/> ИНТЕРАКТИВНЫЙ КАТАЛОГ</span><span>ВИД ¾</span></div>
    <svg className="vehicle" viewBox="0 0 800 430" role="img" aria-label="Условная схема автомобиля, вид спереди и сбоку">
      <defs>
        <linearGradient id="paint" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fafbfa"/><stop offset=".5" stopColor="#d3d8d6"/><stop offset="1" stopColor="#eceeec"/></linearGradient>
        <linearGradient id="side" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#e9ece8"/><stop offset="1" stopColor="#aeb7b1"/></linearGradient>
        <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#9aa8a1" stopOpacity=".25"/><stop offset="1" stopColor="#53625b" stopOpacity=".55"/></linearGradient>
        <radialGradient id="wheel"><stop stopColor="#c1c8c2"/><stop offset=".6" stopColor="#808e84"/><stop offset=".62" stopColor="#37433b"/><stop offset="1" stopColor="#1d2821"/></radialGradient>
        <filter id="shadow"><feGaussianBlur stdDeviation="13"/></filter>
        <pattern id="mesh" width="10" height="10" patternUnits="userSpaceOnUse"><path d="m0 5 5-5 5 5-5 5z" fill="none" stroke="#8f9b93" strokeWidth=".7"/></pattern>
      </defs>
      <ellipse cx="413" cy="349" rx="284" ry="22" fill="#536b5c" opacity=".14" filter="url(#shadow)"/>
      <g stroke="#74877a" strokeWidth="1.2" strokeLinejoin="round">
        <path d="m143 206 38-61 172-47 155 20 103 84 93 34 8 76-48 31-108 7-377-68-36-34z" fill="url(#side)"/>
        <ellipse cx="211" cy="280" rx="40" ry="57" transform="rotate(-14 211 280)" fill="#17271d" stroke="#4a5c4f"/>
        <ellipse cx="223" cy="279" rx="33" ry="51" transform="rotate(-14 223 279)" fill="url(#wheel)"/>
        <ellipse cx="223" cy="279" rx="22" ry="36" transform="rotate(-14 223 279)" fill="none" stroke="#b4beb7" strokeWidth="3"/>
        <path d="m218 244 9 70m-25-50 42 31m-37 10 32-53" stroke="#c9d0cb" strokeWidth="3"/>
        <ellipse cx="550" cy="328" rx="44" ry="58" transform="rotate(-10 550 328)" fill="#17271d" stroke="#4a5c4f"/>
        <ellipse cx="563" cy="327" rx="35" ry="52" transform="rotate(-10 563 327)" fill="url(#wheel)"/>
        <ellipse cx="563" cy="327" rx="24" ry="37" transform="rotate(-10 563 327)" fill="none" stroke="#b4beb7" strokeWidth="3"/>
        <path d="m557 291 12 73m-27-53 45 34m-40 10 32-55" stroke="#c9d0cb" strokeWidth="3"/>
        <path d="m144 204 53-53 166-41 142 21 103 82-85 27-75-11-297-34z" fill="url(#paint)"/>
        <path d="m365 110 140 21 103 82-99-12z" fill="url(#glass)"/>
        <path d="m365 110 126 22 91 69-73-9z" fill="none" stroke="#c6cec8" strokeWidth="4"/>
        <path d="m196 157 159-39 132 78-318-34z" fill="url(#glass)"/>
        <path d="m276 138 17 49m62-69 12 78m-171-39 159-39 132 78-318-34z" fill="none" stroke="#d6ded7" strokeWidth="5"/>
        <path d="m169 166 319 35 34 39-374-45z" fill="url(#paint)"/>
        <path d="m148 195 373 45 37 30 146-34-93-34-103 11-21-12z" fill="url(#paint)"/>
        <path d="m558 270 146-34 8 76-48 31-59 4c7-43-9-70-47-77z" fill="url(#side)"/>
        <path d="m607 277 87-22 2 50-91 21z" fill="url(#mesh)"/>
        <path d="m606 277 88-22m-87 68 89-22" stroke="#63776a" strokeWidth="4"/>
        <path d="m540 252 51-8 16 12-44 12zm119-27 42 13-5 9-45-10z" fill="#f9fcf7" stroke="#9eaca2" strokeWidth="2"/>
        <path d="m143 206 35 8c21-16 56 5 70 36l235 34c7-32 28-44 58-22m-391-32 16 29m93-47 14 60m93-48 14 67m105-50 3 57" fill="none" stroke="#778c7c"/>
        <path d="m262 220 13 2m99 8 15 2" stroke="#5b7162" strokeWidth="3"/>
        <path d="m510 213-27-10-14 7 9 11 33 4z" fill="#c3ccc5"/>
        <path d="m252 266 227 34m134 36 72-17" stroke="#728778" strokeWidth="5"/>
        <path d="m171 146 19-4 166-45 148 20" fill="none" stroke="#788d7e" strokeWidth="3"/>
      </g>
      <g stroke="#91a494" strokeWidth=".8" opacity=".38" fill="none" strokeDasharray="4 5"><path d="m106 271 464 79 166-47M355 82v277M113 199l598 67M177 129l381 200"/></g>
      <g stroke="#8b9e8f" strokeWidth=".8" opacity=".45"><path d="M134 372h551m-551-5v10m551-10v10M730 211v117m-5-117h10m-10 117h10"/></g>
      <text x="395" y="390" fill="#88978b" fontSize="10" fontFamily="monospace" letterSpacing="2">НАВИГАЦИОННАЯ СХЕМА</text>
    </svg>
    {pins.map((pin) => <button key={pin.id} className={`map-pin ${selected === pin.id ? 'is-active' : ''}`} style={{ left: `${pin.x}%`, top: `${pin.y}%` }} onClick={() => onSelect(pin.id)} aria-label={`Показать раздел: ${pin.name}`} aria-pressed={selected === pin.id}><span>{pin.number}</span><span className="pin-tooltip">{pin.name}<Icon name="arrow" size={15}/></span></button>)}
    <div className="map-bottomline"><span><Icon name="plus" size={14}/> Нажмите на узел автомобиля</span><span>06 ТОЧЕК ВЫБОРА</span></div>
  </div>;
}
