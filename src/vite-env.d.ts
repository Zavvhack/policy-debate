/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare const __SINGLE_FILE__: boolean;

// The PDF engine ships without type declarations for these entry points.
declare module 'pdfjs-dist/build/pdf.worker.mjs';
