import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El backend corre en HTTPS con certificado autofirmado (ver
// src/server.js > asegurarCertificado). El proxy hace que el navegador
// solo hable con este dev server (mismo origen para /api y los assets),
// asi que no hace falta CORS ni lidiar con el certificado autofirmado
// desde el navegador -- "secure:false" le dice al proxy que no valide
// ese certificado al conectarse el (Vite corriendo en Node) al backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://localhost:8443',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
