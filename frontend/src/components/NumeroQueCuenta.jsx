import { useLayoutEffect, useRef, useState } from 'react';

// Rediseño "más vida" (2026-11-16, traído de DaleFit): las cifras del panel verde cuentan desde 0
// hasta su valor al aparecer.

const DURACION_MS = 900;

// Parte un texto ya formateado ("$1.234.567", "14", "36 unidades") en texto fijo y números, con el
// formato de cada número tal como vino (separador de miles y decimales). Si un número no se puede
// volver a escribir igual, queda como texto fijo (no se anima).
function piezas(texto) {
  const salida = [];
  let ultimo = 0;
  for (const m of texto.matchAll(/\d+(?:\.\d{3})*(?:,\d+)?/g)) {
    const crudo = m[0];
    const decimales = (crudo.split(',')[1] ?? '').length;
    const valor = Number(crudo.replace(/\./g, '').replace(',', '.'));
    const opciones = { minimumFractionDigits: decimales, maximumFractionDigits: decimales };
    const formato = [new Intl.NumberFormat('es-AR', opciones), new Intl.NumberFormat('es-AR', { ...opciones, useGrouping: false })].find(
      (f) => f.format(valor) === crudo
    );
    if (!formato) continue;
    if (m.index > ultimo) salida.push({ texto: texto.slice(ultimo, m.index) });
    salida.push({ valor, formato, decimales });
    ultimo = m.index + crudo.length;
  }
  if (ultimo < texto.length) salida.push({ texto: texto.slice(ultimo) });
  return salida;
}

function escribir(p, avance) {
  return p
    .map((x) => {
      if ('texto' in x) return x.texto;
      const potencia = 10 ** x.decimales;
      return x.formato.format(Math.round(x.valor * avance * potencia) / potencia);
    })
    .join('');
}

// Cuenta la primera vez que llega un valor distinto de 0: los datos llegan después de montar la
// pantalla, así que arranca mostrando "$0" y cuenta cuando llega la cifra real. Después, si el valor
// cambia (un filtro, un pago), cambia sin contar. Con "reducir movimiento" no se anima. El lector de
// pantalla lee siempre el valor final.
export default function NumeroQueCuenta({ texto }) {
  const yaConto = useRef(false);
  const [mostrado, setMostrado] = useState(texto);

  useLayoutEffect(() => {
    const p = piezas(texto);
    const hayValor = p.some((x) => 'valor' in x && x.valor !== 0);
    const contar = !yaConto.current && hayValor && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!contar) {
      if (hayValor) yaConto.current = true;
      setMostrado(texto);
      return undefined;
    }
    let cuadro = 0;
    let terminado = false;
    const inicio = performance.now();
    const paso = (t) => {
      const avance = Math.min(1, Math.max(0, (t - inicio) / DURACION_MS));
      terminado = avance >= 1;
      setMostrado(terminado ? texto : escribir(p, 1 - Math.pow(1 - avance, 3)));
      if (!terminado) cuadro = requestAnimationFrame(paso);
    };
    yaConto.current = true;
    setMostrado(escribir(p, 0));
    cuadro = requestAnimationFrame(paso);
    return () => {
      cancelAnimationFrame(cuadro);
      // Cortado a mitad de camino (modo estricto de desarrollo, o cambió el valor): que vuelva a contar.
      if (!terminado) yaConto.current = false;
    };
  }, [texto]);

  return (
    <>
      <span aria-hidden="true">{mostrado}</span>
      <span className="sr-only">{texto}</span>
    </>
  );
}
