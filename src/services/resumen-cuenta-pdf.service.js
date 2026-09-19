import PDFDocument from 'pdfkit';
import { hoyNegocio } from '../utils/fecha-negocio.js';
import { ZONA_NEGOCIO } from './clientes-empresa.service.js';

// Colores de marca (marca.md): Verde Esmeralda Oscuro para acentos. Rosa Coral y
// Dorado quedan afuera a propósito -- son exclusivos de alertas urgentes y un
// saldo a cobrar no lo es.
const VERDE = '#0e4b38';
const TEXTO = '#1b2622';
const TEXTO_SUAVE = '#6b7672';
const BORDE = '#dcdfe2';
const FONDO_SUAVE = '#f1f3f4';

const MARGEN = 40;
const ANCHO_PAGINA = 595.28;
const ALTO_PAGINA = 841.89;
const ANCHO_UTIL = ANCHO_PAGINA - MARGEN * 2;
const LIMITE_INFERIOR = ALTO_PAGINA - 60; // deja lugar al pie de página

// Columnas de la tabla de movimientos (suman ANCHO_UTIL ≈ 515).
const COLUMNAS = [
  { clave: 'fecha', titulo: 'Fecha', ancho: 92, alinear: 'left' },
  { clave: 'tipo', titulo: 'Tipo', ancho: 52, alinear: 'left' },
  { clave: 'detalle', titulo: 'Detalle', ancho: 139, alinear: 'left' },
  { clave: 'debe', titulo: 'Debe', ancho: 72, alinear: 'right' },
  { clave: 'haber', titulo: 'Haber', ancho: 72, alinear: 'right' },
  { clave: 'saldo', titulo: 'Saldo', ancho: 88, alinear: 'right' },
];

const ETIQUETA_TIPO = { CARGO: 'Cargo', PAGO: 'Pago', AJUSTE: 'Ajuste' };

function monto(valor) {
  const n = Math.round(Number(valor) || 0);
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('es-AR')}`;
}

function fechaISOaAR(iso) {
  const [anio, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${anio}`;
}

// 'dd/mm/aaaa hh:mm' fijo, en 24 horas: el formato por defecto de es-AR trae
// "p. m." con espacios, que se parte en dos líneas dentro de la columna.
const FORMATO_FECHA_HORA = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_NEGOCIO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function formatearFechaHora(fecha) {
  const p = Object.fromEntries(FORMATO_FECHA_HORA.formatToParts(fecha).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

function fechaHoraAR(datetimeUtc) {
  return formatearFechaHora(new Date(`${datetimeUtc.replace(' ', 'T')}Z`));
}

function textoPeriodo(desde, hasta) {
  if (desde && hasta) return `Del ${fechaISOaAR(desde)} al ${fechaISOaAR(hasta)}`;
  if (desde) return `Desde el ${fechaISOaAR(desde)}`;
  if (hasta) return `Hasta el ${fechaISOaAR(hasta)}`;
  return 'Todo el historial';
}

function dibujarEncabezado(doc) {
  doc.rect(0, 0, ANCHO_PAGINA, 64).fill(VERDE);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('CEAVital', MARGEN, 22, { lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(10)
    .text('Sistema de gestión para negocios', MARGEN, 26, { width: ANCHO_UTIL, align: 'right', lineBreak: false });
}

function dibujarDatosCliente(doc, y, cliente) {
  const alto = 78;
  doc.roundedRect(MARGEN, y, ANCHO_UTIL, alto, 6).fill(FONDO_SUAVE);

  doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(13).text(cliente.razon_social, MARGEN + 14, y + 12, {
    width: ANCHO_UTIL / 2 - 20,
    height: 34,
    ellipsis: true,
  });
  doc.fillColor(TEXTO_SUAVE).font('Helvetica').fontSize(9);
  doc.text(`CUIT: ${cliente.cuit || '—'}`, MARGEN + 14, y + 50, { lineBreak: false });
  doc.text(`Condición de pago: ${cliente.condicion_pago || '—'}`, MARGEN + 14, y + 62, { lineBreak: false });

  const xDer = MARGEN + ANCHO_UTIL / 2 + 10;
  const anchoDer = ANCHO_UTIL / 2 - 24;
  const filas = [
    ['Contacto', cliente.contacto_nombre],
    ['Teléfono', cliente.telefono],
    ['Email', cliente.email],
    ['Dirección', cliente.direccion],
  ];
  let yy = y + 12;
  for (const [etiqueta, valor] of filas) {
    doc.fillColor(TEXTO_SUAVE).font('Helvetica').fontSize(9).text(`${etiqueta}:`, xDer, yy, { width: 52, lineBreak: false });
    doc
      .fillColor(TEXTO)
      .text(valor || '—', xDer + 52, yy, { width: anchoDer - 52, height: 12, ellipsis: true, lineBreak: false });
    yy += 15;
  }
  return y + alto;
}

function dibujarTotales(doc, y, resumen) {
  const cajas = [
    { titulo: 'Saldo anterior', valor: resumen.saldo_anterior },
    { titulo: 'Cargos', valor: resumen.total_cargos },
    { titulo: 'Pagos', valor: resumen.total_pagos },
    { titulo: 'Ajustes', valor: resumen.total_ajustes },
    { titulo: 'Saldo final', valor: resumen.saldo_final, destacada: true },
  ];
  const separacion = 8;
  const ancho = (ANCHO_UTIL - separacion * (cajas.length - 1)) / cajas.length;
  const alto = 46;

  cajas.forEach((caja, i) => {
    const x = MARGEN + i * (ancho + separacion);
    if (caja.destacada) {
      doc.roundedRect(x, y, ancho, alto, 6).fill(VERDE);
    } else {
      doc.roundedRect(x, y, ancho, alto, 6).lineWidth(0.8).strokeColor(BORDE).stroke();
    }
    doc
      .fillColor(caja.destacada ? '#bfe0d3' : TEXTO_SUAVE)
      .font('Helvetica')
      .fontSize(8.5)
      .text(caja.titulo, x + 10, y + 9, { width: ancho - 20, lineBreak: false });
    doc
      .fillColor(caja.destacada ? '#ffffff' : TEXTO)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(monto(caja.valor), x + 10, y + 25, { width: ancho - 20, lineBreak: false });
  });
  return y + alto;
}

function dibujarEncabezadoTabla(doc, y) {
  doc.rect(MARGEN, y, ANCHO_UTIL, 20).fill(VERDE);
  let x = MARGEN;
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
  for (const col of COLUMNAS) {
    doc.text(col.titulo.toUpperCase(), x + 6, y + 6.5, { width: col.ancho - 12, align: col.alinear, lineBreak: false });
    x += col.ancho;
  }
  return y + 20;
}

function alturaFila(doc, celdas) {
  doc.font('Helvetica').fontSize(8.5);
  const colDetalle = COLUMNAS.find((c) => c.clave === 'detalle');
  const altoDetalle = doc.heightOfString(celdas.detalle || ' ', { width: colDetalle.ancho - 12 });
  return Math.max(20, altoDetalle + 12);
}

function dibujarFila(doc, y, celdas, { par, negrita = false, fondo = null }) {
  const alto = alturaFila(doc, celdas);
  if (fondo) doc.rect(MARGEN, y, ANCHO_UTIL, alto).fill(fondo);
  else if (par) doc.rect(MARGEN, y, ANCHO_UTIL, alto).fill('#f8f9fa');

  let x = MARGEN;
  doc.fillColor(TEXTO).font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
  for (const col of COLUMNAS) {
    doc.text(celdas[col.clave] ?? '', x + 6, y + 6, { width: col.ancho - 12, align: col.alinear });
    x += col.ancho;
  }
  doc.moveTo(MARGEN, y + alto).lineTo(MARGEN + ANCHO_UTIL, y + alto).lineWidth(0.5).strokeColor(BORDE).stroke();
  return y + alto;
}

function detalleDe(m) {
  const partes = [];
  if (m.venta_id) partes.push(`Venta #${m.venta_id}`);
  if (m.descripcion) partes.push(m.descripcion);
  return partes.join(' - ');
}

function dibujarPies(doc) {
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i += 1) {
    doc.switchToPage(paginas.start + i);
    // Sin esto, escribir cerca del borde inferior dispara un salto de página automático.
    doc.page.margins.bottom = 0;
    doc.moveTo(MARGEN, ALTO_PAGINA - 44).lineTo(MARGEN + ANCHO_UTIL, ALTO_PAGINA - 44).lineWidth(0.5).strokeColor(BORDE).stroke();
    doc
      .fillColor(TEXTO_SUAVE)
      .font('Helvetica')
      .fontSize(8)
      .text('Documento generado por CEAVital', MARGEN, ALTO_PAGINA - 36, { lineBreak: false });
    doc.text(`Página ${i + 1} de ${paginas.count}`, MARGEN, ALTO_PAGINA - 36, {
      width: ANCHO_UTIL,
      align: 'right',
      lineBreak: false,
    });
  }
}

// Nombre de archivo seguro para el header Content-Disposition: solo ASCII, sin
// espacios ni caracteres que rompan el header.
function nombreArchivoSeguro(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// Arma el PDF y lo manda como descarga. Lo usan el resumen que baja el
// Admin/Encargado desde la ficha y el que baja el propio cliente desde su
// portal (mismo documento, distinto control de acceso).
export function enviarResumenCuentaPdf(res, resumen) {
  const hoy = hoyNegocio();
  const nombre = `Resumen-cuenta-${nombreArchivoSeguro(resumen.cliente.razon_social) || 'cliente'}-${hoy}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.setHeader('Cache-Control', 'no-store');
  generarResumenCuentaPdf(resumen).pipe(res);
}

// Devuelve el PDFDocument (stream legible): quien lo llama hace doc.pipe(res).
// `resumen` es lo que devuelve armarResumenCuenta().
export function generarResumenCuentaPdf(resumen) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGEN,
    bufferPages: true,
    info: {
      Title: `Resumen de cuenta corriente - ${resumen.cliente.razon_social}`,
      Author: 'CEAVital',
    },
  });

  dibujarEncabezado(doc);

  let y = 86;
  doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(16).text('Resumen de cuenta corriente', MARGEN, y, { lineBreak: false });
  y += 24;
  doc
    .fillColor(TEXTO_SUAVE)
    .font('Helvetica')
    .fontSize(9.5)
    .text(`Período: ${textoPeriodo(resumen.desde, resumen.hasta)}`, MARGEN, y, { lineBreak: false });
  doc.text(`Emitido el ${formatearFechaHora(new Date())}`, MARGEN, y, {
    width: ANCHO_UTIL,
    align: 'right',
    lineBreak: false,
  });
  y += 22;

  y = dibujarDatosCliente(doc, y, resumen.cliente) + 14;
  y = dibujarTotales(doc, y, resumen) + 22;

  doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(11).text('Detalle de movimientos', MARGEN, y, { lineBreak: false });
  y += 18;
  y = dibujarEncabezadoTabla(doc, y);

  const filas = [];
  if (resumen.desde) {
    filas.push({
      celdas: { fecha: fechaISOaAR(resumen.desde), tipo: '', detalle: 'Saldo anterior', debe: '', haber: '', saldo: monto(resumen.saldo_anterior) },
      opciones: { negrita: true, fondo: FONDO_SUAVE },
    });
  }
  for (const m of resumen.movimientos) {
    filas.push({
      celdas: {
        fecha: fechaHoraAR(m.creado_en),
        tipo: ETIQUETA_TIPO[m.tipo] ?? m.tipo,
        detalle: detalleDe(m),
        debe: m.monto > 0 ? monto(m.monto) : '',
        haber: m.monto < 0 ? monto(-m.monto) : '',
        saldo: monto(m.saldo),
      },
      opciones: {},
    });
  }

  if (filas.length === 0) {
    doc.fillColor(TEXTO_SUAVE).font('Helvetica').fontSize(10).text('Sin movimientos en el período seleccionado.', MARGEN, y + 16, {
      width: ANCHO_UTIL,
      align: 'center',
      lineBreak: false,
    });
    y += 40;
  }

  filas.forEach((fila, i) => {
    if (y + alturaFila(doc, fila.celdas) > LIMITE_INFERIOR) {
      doc.addPage();
      y = dibujarEncabezadoTabla(doc, MARGEN);
    }
    y = dibujarFila(doc, y, fila.celdas, { par: i % 2 === 1, ...fila.opciones });
  });

  // Fila de cierre: siempre cabe una fila más, si no salta de página.
  const totalDebe = resumen.movimientos.reduce((suma, m) => (m.monto > 0 ? suma + m.monto : suma), 0);
  const totalHaber = resumen.movimientos.reduce((suma, m) => (m.monto < 0 ? suma - m.monto : suma), 0);
  const cierre = {
    fecha: '',
    tipo: '',
    detalle: 'Saldo final',
    debe: monto(totalDebe),
    haber: monto(totalHaber),
    saldo: monto(resumen.saldo_final),
  };
  if (y + alturaFila(doc, cierre) > LIMITE_INFERIOR) {
    doc.addPage();
    y = dibujarEncabezadoTabla(doc, MARGEN);
  }
  dibujarFila(doc, y, cierre, { par: false, negrita: true, fondo: FONDO_SUAVE });

  dibujarPies(doc);
  doc.end();
  return doc;
}
