import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Exposto na rede local para testar de celulares/tablets.
    host: true,
    port: 5173,
  },
});
