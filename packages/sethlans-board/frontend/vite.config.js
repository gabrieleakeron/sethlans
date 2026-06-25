import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // ascolta su 0.0.0.0 (necessario dentro il container)
    port: 5173,
    // In container su Windows gli eventi del filesystem non attraversano i
    // bind mount: con VITE_USE_POLLING=true si rileva comunque ogni modifica.
    watch: process.env.VITE_USE_POLLING
      ? { usePolling: true, interval: 150 }
      : undefined,
  },
});
