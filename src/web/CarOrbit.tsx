import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { drawCar } from './carModel';
import './carOrbit.css';

const fullTurn = Math.PI * 2;
const defaultYaw = Math.PI / 6;
const buttonStep = Math.PI / 6;
const maxPixelRatio = 1.5;

export function CarOrbit({ selected, profile = false }: { selected: string[]; profile?: boolean }) {
  const selection = selected.join(',');
  const selectedRef = useRef<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const yaw = useRef(defaultYaw);
  const pointer = useRef<{ id: number; x: number } | null>(null);
  const schedule = useRef<() => void>(() => {});
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    selectedRef.current = selection ? selection.split(',') : [];
    schedule.current();
  }, [selection]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const supported = typeof Path2D !== 'undefined' && typeof ResizeObserver !== 'undefined';
    const context = supported && canvas?.getContext('2d');
    if (!canvas || !context) {
      setAvailable(false);
      return;
    }

    let frame: number | null = null;
    let width = 0;
    let height = 0;
    function paint() {
      frame = null;
      if (width > 0 && height > 0 && context) drawCar(context, width, height, profile ? 0 : yaw.current, selectedRef.current, profile);
    }
    schedule.current = () => {
      if (frame === null) frame = requestAnimationFrame(paint);
    };

    const observer = new ResizeObserver(([entry]) => {
      const { width: nextWidth, height: nextHeight } = entry.contentRect;
      if (!nextWidth || !nextHeight) return;
      const ratio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
      width = nextWidth;
      height = nextHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      schedule.current();
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      schedule.current = () => {};
    };
  }, [profile]);

  function rotate(delta: number) {
    yaw.current = (yaw.current + delta) % fullTurn;
    schedule.current();
  }

  function startDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || pointer.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { id: event.pointerId, x: event.clientX };
  }

  function moveDrag(event: PointerEvent<HTMLCanvasElement>) {
    const drag = pointer.current;
    if (!drag || drag.id !== event.pointerId) return;
    const width = event.currentTarget.clientWidth;
    if (!width) return;
    const distance = event.clientX - drag.x;
    drag.x = event.clientX;
    if (distance) rotate(distance * fullTurn / width);
  }

  function endDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (pointer.current?.id === event.pointerId) pointer.current = null;
  }

  if (profile && !available) return <img className="vehicle" src={`${import.meta.env.BASE_URL}car-profile.webp`} alt="Автомобиль сбоку"/>;
  if (profile) return <canvas className="vehicle car-profile" ref={canvasRef} role="img" aria-label="Выбранные узлы на боковой схеме"/>;
  if (!available) return <p className="car-orbit-status" role="status">3D недоступно. Узел можно выбрать на боковой схеме.</p>;

  return <div className="car-orbit">
    <canvas ref={canvasRef} className="car-orbit-canvas" role="img"
      aria-label="Схематичная 3D-модель автомобиля"
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}
      onPointerCancel={endDrag} onLostPointerCapture={endDrag}/>
    <div className="car-orbit-toolbar">
      <p className="car-orbit-hint">Проведите вбок, чтобы повернуть автомобиль.</p>
      <div className="car-orbit-controls" role="group" aria-label="Вращение автомобиля">
        <button type="button" onClick={() => rotate(-buttonStep)} aria-label="Повернуть влево">←</button>
        <button type="button" onClick={() => { yaw.current = defaultYaw; schedule.current(); }}>Сбросить ракурс</button>
        <button type="button" onClick={() => rotate(buttonStep)} aria-label="Повернуть вправо">→</button>
      </div>
    </div>
  </div>;
}
