// Patrones de la defensa por IP: no tienen que bloquear textos normales de un comercio y sí
// tienen que seguir detectando ataques reales. Es una prueba unitaria: no abre ninguna
// conexión (el pool de pg es perezoso), por eso alcanza una DATABASE_URL de mentira.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.DATABASE_URL ||= 'postgres://nadie:nada@127.0.0.1:1/ninguna';
const { detectarEnCuerpo, detectarEnPedido } = await import('../src/services/defensa-ip.service.js');

const pedido = (url, cuerpo) => ({ originalUrl: url, url, body: cuerpo, get: () => '' });

const TEXTOS_COMERCIALES = [
  'Sleep (colchón 2 plazas)',
  'JavaScript: guía completa',
  'Benchmark (línea pro)',
  'onload = lento',
  'Doc: eval (prueba)',
];

describe('defensa por IP: patrones', () => {
  it('no bloquea textos comerciales normales, ni como nombre ni como búsqueda', () => {
    for (const texto of TEXTOS_COMERCIALES) {
      assert.equal(detectarEnCuerpo(pedido('/api/proveedores', { nombre: texto })), null, `cuerpo: ${texto}`);
      assert.equal(detectarEnCuerpo(pedido('/api/productos', { nombre: texto, notas: texto })), null, `cuerpo: ${texto}`);
      assert.equal(detectarEnPedido(pedido(`/api/productos?buscar=${encodeURIComponent(texto)}`)), null, `búsqueda: ${texto}`);
    }
    assert.equal(detectarEnPedido(pedido('/api/productos?buscar=Sleep (')), null);
    assert.equal(detectarEnPedido(pedido('/api/productos?buscar=Sleep%20(')), null);
  });

  it('sigue detectando inyección SQL real', () => {
    const casos = [
      "x' UNION SELECT usuario, password_hash FROM usuarios--",
      "admin' OR '1'='1",
      '1; SELECT pg_sleep(5)',
      '1 AND SLEEP(5)',
      '1 AND sleep( 5 ) --',
      'x AND BENCHMARK(5000000,MD5(1))',
      "x' AND benchmark (100, md5('a'))",
      'SELECT load_file(0x2f6574632f706173737764)',
    ];
    for (const c of casos) assert.equal(detectarEnCuerpo(pedido('/api/x', { nombre: c })), 'inyeccion_sql', c);
  });

  it('sigue detectando XSS real', () => {
    const casos = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '<body onload = "x()">',
      '" onmouseover="alert(1)',
      '<a href="javascript:alert(1)">x</a>',
      'javascript:void(0)',
      '<iframe src=x>',
      'eval("alert(1)")',
      'eval(atob("YWxlcnQoMSk="))',
      'eval(String.fromCharCode(97))',
      'x=document.cookie',
    ];
    for (const c of casos) assert.equal(detectarEnCuerpo(pedido('/api/x', { nombre: c })), 'xss', c);
  });

  it('sigue detectando comandos, traversal y herramientas', () => {
    assert.equal(detectarEnCuerpo(pedido('/api/x', { usuario: 'a; cat /etc/passwd' })), 'comando');
    assert.equal(detectarEnCuerpo(pedido('/api/x', { usuario: '$(whoami)' })), 'comando');
    assert.equal(detectarEnPedido(pedido('/api/productos?archivo=../../etc/passwd')), 'traversal');
    const conAgente = { originalUrl: '/api/health', url: '/api/health', get: () => 'sqlmap/1.7' };
    assert.equal(detectarEnPedido(conAgente), 'herramienta');
  });

  it('un texto enorme sin ">" no cuelga la revisión', () => {
    const t0 = Date.now();
    detectarEnCuerpo(pedido('/api/x', { nombre: '<'.repeat(150_000) }));
    assert.ok(Date.now() - t0 < 2000);
  });
});
